import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseService } from "@/lib/auth";
import { getApiIdentity } from "@/lib/api-identity";
import {
  parseDispatchWorkbook,
  planDispatchPackaging,
} from "@/lib/dispatch-planning";
import { createDispatchPreviewToken } from "@/lib/dispatch-preview-token";
import { loadDispatchPackagingOptions } from "@/app/api/dispatch-planning/_server";
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

    const sourceHash = createHash("sha256").update(buffer).digest("hex");
    const orderIds = parsed.orders.map((order) => order.orderId);
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
    const plan = planDispatchPackaging(parsed.orders, packages);
    const previewToken = createDispatchPreviewToken({
      sourceHash,
      sourceFilename: file.name || "daily-dispatch.xlsx",
      sourceGeneratedAt: parsed.generatedAt,
      orders: parsed.orders,
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
