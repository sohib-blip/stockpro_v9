import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseService } from "@/lib/auth";
import { getApiIdentity } from "@/lib/api-identity";
import {
  applyDispatchAutomaticAccessoryRules,
  applyDispatchPackagingSelections,
  eligibleDispatchPackagingIds,
  parseDispatchWorkbook,
} from "@/lib/dispatch-planning";
import { dispatchCompositionKey } from "@/lib/dispatch-learning";
import { createDispatchPreviewToken } from "@/lib/dispatch-preview-token";
import {
  loadDispatchAutomaticAccessoryRules,
  loadDispatchPackagingOptions,
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

    const parsed = parseDispatchWorkbook(workbook);
    if (parsed.orders.length > MAX_ORDERS || parsed.lines.length > MAX_LINES) {
      throw new PayloadTooLargeError(
        `A dispatch preview supports at most ${MAX_ORDERS} orders and ${MAX_LINES} lines.`
      );
    }
    if (parsed.issues.length > 0 || parsed.orders.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The workbook contains unknown or incomplete rows. Nothing was deducted.",
          issues: parsed.issues.slice(0, 100),
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
      automaticRules
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
    const dispatchOrders = enriched.orders;

    const sourceHash = createHash("sha256").update(buffer).digest("hex");
    const orderIds = dispatchOrders.map((order) => order.orderId);
    const service = supabaseService();
    const [{ data: sameSource, error: sourceError }, { data: sameOrders, error: ordersError }] =
      await Promise.all([
        service
          .from("dispatch_batches")
          .select("id,source_filename,confirmed_at")
          .eq("status", "CONFIRMED")
          .eq("source_sha256", sourceHash)
          .limit(1),
        service
          .from("dispatch_batches")
          .select("id,source_filename,confirmed_at,order_ids")
          .eq("status", "CONFIRMED")
          .overlaps("order_ids", orderIds)
          .limit(10),
      ]);
    if (sourceError || ordersError) throw sourceError || ordersError;

    if ((sameSource || []).length > 0 || (sameOrders || []).length > 0) {
      const existingIds = new Set(
        (sameOrders || []).flatMap((batch) =>
          (batch.order_ids || []).filter((id: string) => orderIds.includes(id))
        )
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            (sameSource || []).length > 0
              ? "This workbook has already been confirmed. Packaging stock was not changed."
              : `${existingIds.size} order(s) were already confirmed in another dispatch batch. Packaging stock was not changed.`,
          duplicate_order_ids: Array.from(existingIds).slice(0, 100),
        },
        { status: 409 }
      );
    }

    const packages = await loadDispatchPackagingOptions();
    const compositionKeys = new Map(
      dispatchOrders.map((order) => [order.orderId, dispatchCompositionKey(order)])
    );
    const { data: learnedRows, error: learnedError } = await service
      .from("dispatch_packaging_preferences")
      .select(
        "composition_key,packaging_type_id,package_quantity,confirmation_count"
      )
      .in("composition_key", Array.from(compositionKeys.values()));
    if (learnedError) throw learnedError;

    const activePackageIds = new Set(packages.map((packaging) => packaging.id));
    const learnedByComposition = new Map(
      (learnedRows || [])
        .filter((row) => activePackageIds.has(String(row.packaging_type_id)))
        .map((row) => [String(row.composition_key), row])
    );
    const learnedSelections = dispatchOrders.flatMap((order) => {
      const learned = learnedByComposition.get(compositionKeys.get(order.orderId)!);
      const eligibleIds = new Set(eligibleDispatchPackagingIds(order, packages));
      return learned && eligibleIds.has(String(learned.packaging_type_id))
        ? [
            {
              orderId: order.orderId,
              packagingTypeId: String(learned.packaging_type_id),
              quantity: Number(learned.package_quantity),
              source: "learned" as const,
              learningCount: Number(learned.confirmation_count || 1),
            },
          ]
        : [];
    });
    const calculatedPlan = applyDispatchPackagingSelections(
      dispatchOrders,
      packages,
      learnedSelections
    );
    const plan = {
      ...calculatedPlan,
      orders: calculatedPlan.orders.map((order) => ({
        ...order,
        compositionKey: compositionKeys.get(order.orderId),
        eligiblePackagingTypeIds: eligibleDispatchPackagingIds(order, packages),
      })),
    };
    const previewToken = createDispatchPreviewToken({
      sourceHash,
      sourceFilename: file.name || "daily-dispatch.xlsx",
      sourceGeneratedAt: parsed.generatedAt,
      orders: dispatchOrders,
    });

    return NextResponse.json({
      ok: plan.blockers.length === 0,
      error:
        plan.blockers.length > 0
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
        lengthCm: packaging.lengthCm,
        widthCm: packaging.widthCm,
        heightCm: packaging.heightCm,
        onHandStock: packaging.onHandStock,
        reservedStock: packaging.reservedStock,
        availableStock: packaging.onHandStock - packaging.reservedStock,
      })),
      plan,
    }, { status: plan.blockers.length > 0 ? 422 : 200 });
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
