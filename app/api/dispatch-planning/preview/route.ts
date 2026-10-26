import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseService } from "@/lib/auth";
import { getApiIdentity } from "@/lib/api-identity";
import {
  applyDispatchAutomaticAccessoryRules,
  applyDispatchPackagingSelections,
  buildDispatchPickingSummary,
  eligibleDispatchPackagingIds,
  parseDispatchWorkbook,
} from "@/lib/dispatch-planning";
import { buildDispatchVehicleLabels } from "@/lib/dispatch-vehicle-labels";
import { dispatchCompositionKey } from "@/lib/dispatch-learning";
import { createDispatchPreviewToken } from "@/lib/dispatch-preview-token";
import { isPackagingContainer } from "@/lib/packaging";
import {
  loadDispatchAutomaticAccessoryRules,
  loadDispatchCabinetStock,
  loadDispatchPackagingRules,
  loadDispatchCatalog,
  loadDispatchPackagingOptions,
  loadDispatchPickingInventory,
} from "@/app/api/dispatch-planning/_server";
import {
  PayloadTooLargeError,
  readBodyWithinLimit,
  requestWithBoundedBody,
} from "@/lib/security/request-budget";
import {
  inspectXlsxZipEnvelope,
  measureWorkbookShape,
} from "@/lib/security/xlsx-budget";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 256 * 1024;
const MAX_ORDERS = 500;
const MAX_LINES = 10_000;

type LearnedPackaging = {
  compositionKey: string;
  packages: Array<{ packagingTypeId: string; quantity: number }>;
  confirmationCount: number;
};

// Learned packaging per order composition. Before the multiple-packages
// migration only the single packaging_type_id / package_quantity exist.
async function loadLearnedPackaging(
  service: ReturnType<typeof supabaseService>,
  compositionKeys: string[]
): Promise<LearnedPackaging[]> {
  if (compositionKeys.length === 0) return [];
  const table = () => service.from("dispatch_packaging_preferences");
  let result: { data: Array<Record<string, unknown>> | null; error: { code?: string } | null } =
    await table()
      .select("composition_key,packaging_type_id,package_quantity,packages,confirmation_count")
      .in("composition_key", compositionKeys);
  if (result.error?.code === "42703") {
    result = await table()
      .select("composition_key,packaging_type_id,package_quantity,confirmation_count")
      .in("composition_key", compositionKeys);
  }
  if (result.error) throw result.error;
  return (result.data || []).map((row) => {
    const stored = Array.isArray(row.packages) ? row.packages : null;
    const packages = (stored ?? [
      { packagingTypeId: row.packaging_type_id, quantity: row.package_quantity },
    ]).map((item: any) => ({
      packagingTypeId: String(item.packagingTypeId),
      quantity: Number(item.quantity),
    }));
    return {
      compositionKey: String(row.composition_key),
      packages,
      confirmationCount: Number(row.confirmation_count || 1),
    };
  });
}

export async function POST(req: Request) {
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "outboundPreview", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    if (!req.headers.get("content-type")?.includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "Upload the daily workbook as a file." },
        { status: 400 }
      );
    }
    const body = await readBodyWithinLimit(req, MAX_MULTIPART_BYTES);
    const form = await requestWithBoundedBody(req, body).formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, error: "Select the daily vehicle order workbook." },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new PayloadTooLargeError("Workbook exceeds the 3 MB limit.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    inspectXlsxZipEnvelope(buffer, {
      maxCompressedBytes: MAX_FILE_BYTES,
      maxExpandedBytes: 24 * 1024 * 1024,
      maxEntries: 160,
      maxEntryBytes: 12 * 1024 * 1024,
      maxCompressionRatio: 100,
    });
    const workbook = XLSX.read(buffer, { type: "buffer" });
    measureWorkbookShape(workbook, {
      maxSheets: 12,
      maxRowsPerSheet: MAX_LINES,
      maxCells: 200_000,
    });

    const catalog = await loadDispatchCatalog();
    const parsed = parseDispatchWorkbook(workbook, catalog);
    const vehicleLabelResult = buildDispatchVehicleLabels(parsed.lines);
    const parseIssues = [...parsed.issues, ...vehicleLabelResult.issues];
    if (parsed.orders.length > MAX_ORDERS || parsed.lines.length > MAX_LINES) {
      throw new PayloadTooLargeError(
        `A dispatch preview supports at most ${MAX_ORDERS} orders and ${MAX_LINES} lines.`
      );
    }
    if (parseIssues.length > 0 || parsed.orders.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The workbook contains unknown or incomplete rows. Nothing was deducted.",
          issues: parseIssues.slice(0, 100),
          parsed_sheets: parsed.parsedSheets,
          skipped_sheets: parsed.skippedSheets,
        },
        { status: 400 }
      );
    }

    const deviceModels = Array.from(
      new Set(
        parsed.orders.flatMap((order) => Object.keys(order.deviceCounts || {}))
      )
    );
    const automaticRules = await loadDispatchAutomaticAccessoryRules(
      deviceModels
    );
    const enriched = applyDispatchAutomaticAccessoryRules(
      parsed.orders,
      automaticRules,
      catalog
    );
    if (enriched.issues.length > 0) {
      const firstIssue = enriched.issues[0]?.message;
      return NextResponse.json(
        {
          ok: false,
          error: firstIssue
            ? `${firstIssue} Nothing was deducted.`
            : "An automatic accessory rule has missing or invalid volume data. Nothing was deducted.",
          issues: enriched.issues.slice(0, 100),
          parsed_sheets: parsed.parsedSheets,
          skipped_sheets: parsed.skippedSheets,
        },
        { status: 400 }
      );
    }
    const sourceHash = createHash("sha256").update(buffer).digest("hex");
    const allOrderIds = new Set(enriched.orders.map((order) => order.orderId));
    const service = supabaseService();
    // Orders already confirmed in an earlier dispatch (e.g. not shipped yesterday
    // and back in today's sheet) are not deducted again. They stay on the
    // picking sheet and the vehicle labels with the packaging used back then.
    const { data: confirmedBatches, error: confirmedError } = await service
      .from("dispatch_batches")
      .select("source_filename,confirmed_at,orders")
      .eq("status", "CONFIRMED")
      .overlaps("order_ids", Array.from(allOrderIds))
      .order("confirmed_at", { ascending: false })
      .limit(200);
    if (confirmedError) throw confirmedError;

    const confirmedOrders = new Map<
      string,
      { confirmedAt: string; sourceFilename: string; packages: unknown[]; extras: unknown[] }
    >();
    for (const batch of confirmedBatches || []) {
      for (const stored of (batch.orders || []) as Array<Record<string, unknown>>) {
        const orderId = String(stored?.orderId ?? "");
        if (!allOrderIds.has(orderId) || confirmedOrders.has(orderId)) continue;
        confirmedOrders.set(orderId, {
          confirmedAt: String(batch.confirmed_at),
          sourceFilename: String(batch.source_filename),
          packages: Array.isArray(stored.packages) ? stored.packages : [],
          extras: Array.isArray(stored.extras) ? stored.extras : [],
        });
      }
    }
    const dispatchOrders = enriched.orders.filter(
      (order) => !confirmedOrders.has(order.orderId)
    );
    const carriedOrders = enriched.orders
      .filter((order) => confirmedOrders.has(order.orderId))
      .map((order) => {
        const confirmed = confirmedOrders.get(order.orderId)!;
        return {
          ...order,
          packages: confirmed.packages,
          extras: confirmed.extras,
          confirmedAt: confirmed.confirmedAt,
          confirmedIn: confirmed.sourceFilename,
        };
      });
    const nothingNew = dispatchOrders.length === 0;

    const [packages, pickingInventory, cabinetStock, packagingRules] = await Promise.all([
      loadDispatchPackagingOptions(),
      loadDispatchPickingInventory(),
      loadDispatchCabinetStock(),
      loadDispatchPackagingRules(),
    ]);
    const compositionKeys = new Map(
      dispatchOrders.map((order) => [order.orderId, dispatchCompositionKey(order)])
    );
    const learnedRows = await loadLearnedPackaging(
      service,
      Array.from(compositionKeys.values())
    );

    const activePackageIds = new Set(
      packages
        .filter((packaging) => isPackagingContainer(packaging.category))
        .map((packaging) => packaging.id)
    );
    const learnedByComposition = new Map(
      learnedRows
        .filter((row) =>
          row.packages.every((item) => activePackageIds.has(item.packagingTypeId))
        )
        .map((row) => [row.compositionKey, row])
    );
    const learnedSelections = dispatchOrders.flatMap((order) => {
      const learned = learnedByComposition.get(compositionKeys.get(order.orderId)!);
      return (learned?.packages ?? []).map((item) => ({
        orderId: order.orderId,
        packagingTypeId: item.packagingTypeId,
        quantity: item.quantity,
        source: "learned" as const,
        learningCount: learned!.confirmationCount,
      }));
    });
    const calculatedPlan = applyDispatchPackagingSelections(
      dispatchOrders,
      packages,
      learnedSelections,
      packagingRules
    );
    const plan = {
      ...calculatedPlan,
      orders: calculatedPlan.orders.map((order) => ({
        ...order,
        compositionKey: compositionKeys.get(order.orderId),
        eligiblePackagingTypeIds: eligibleDispatchPackagingIds(order, packages),
      })),
    };
    const previewToken = nothingNew ? undefined : createDispatchPreviewToken({
      sourceHash,
      sourceFilename: file.name || "daily-dispatch.xlsx",
      sourceGeneratedAt: parsed.generatedAt,
      orders: dispatchOrders,
    });
    const pickingSummary = buildDispatchPickingSummary(
      plan.orders,
      plan.packageUsage,
      pickingInventory.devices,
      pickingInventory.accessories,
      catalog
    );

    return NextResponse.json({
      ok: plan.blockers.length === 0 && !nothingNew,
      nothing_new: nothingNew,
      error: nothingNew
        ? `Nothing new to deduct: all ${carriedOrders.length} orders of this workbook were already confirmed.`
        : plan.blockers.length > 0
          ? "Packaging recommendations are ready, but stock or dimensions need attention before confirmation."
          : undefined,
      preview_token: previewToken,
      source: {
        filename: file.name,
        generated_at: parsed.generatedAt,
        hash: sourceHash,
        parsed_sheets: parsed.parsedSheets,
        skipped_sheets: parsed.skippedSheets,
      },
      packaging_options: packages.map((packaging) => ({
        id: packaging.id,
        code: packaging.code,
        name: packaging.name,
        category: packaging.category,
        lengthCm: packaging.lengthCm,
        widthCm: packaging.widthCm,
        heightCm: packaging.heightCm,
        onHandStock: packaging.onHandStock,
        reservedStock: packaging.reservedStock,
        availableStock: packaging.onHandStock - packaging.reservedStock,
      })),
      packaging_rules: packagingRules,
      carried_orders: carriedOrders,
      vehicle_label_count: vehicleLabelResult.labels.length,
      picking_summary: pickingSummary,
      cabinet_stock: cabinetStock,
      plan,
    }, { status: plan.blockers.length > 0 && !nothingNew ? 422 : 200 });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 413 }
      );
    }
    console.error("DISPATCH PREVIEW ERROR", error);
    return NextResponse.json(
      { ok: false, error: "The daily dispatch workbook could not be previewed." },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
