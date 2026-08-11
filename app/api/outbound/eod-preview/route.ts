import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  PayloadTooLargeError,
  readBodyWithinLimit,
  readJsonBodyWithinLimit,
  requestWithBoundedBody,
} from "@/lib/security/request-budget";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";
import {
  inspectXlsxZipEnvelope,
  measureWorkbookShape,
} from "@/lib/security/xlsx-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_PREVIEW_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_PREVIEW_FILE_BYTES + 256 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_PREVIEW_IMEIS = 10_000;
const MAX_PREVIEW_BOXES = 250;
const LOOKUP_BATCH_SIZE = 500;
const MAX_LOOKUP_QUERIES = 25;

class InvalidPreviewError extends Error {}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function collectImeisWithinLimit(values: unknown[]) {
  const imeis: string[] = [];

  for (const raw of values) {
    const value = String(raw ?? "");
    for (const match of value.matchAll(/\d{15}/g)) {
      imeis.push(match[0]);
      if (imeis.length > MAX_PREVIEW_IMEIS) {
        throw new PayloadTooLargeError(
          `A preview supports at most ${MAX_PREVIEW_IMEIS} IMEIs`
        );
      }
    }
  }

  return imeis;
}

async function extractWorkbookValues(req: Request) {
  const requestBody = await readBodyWithinLimit(req, MAX_MULTIPART_BYTES);
  const form = await requestWithBoundedBody(req, requestBody).formData();
  const file = form.get("file");

  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function"
  ) {
    throw new InvalidPreviewError("No file uploaded");
  }
  if (file.size > MAX_PREVIEW_FILE_BYTES) {
    throw new PayloadTooLargeError("Workbook exceeds the file-size limit");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  inspectXlsxZipEnvelope(buffer, {
    maxCompressedBytes: MAX_PREVIEW_FILE_BYTES,
    maxExpandedBytes: 16 * 1024 * 1024,
    maxEntries: 128,
    maxEntryBytes: 8 * 1024 * 1024,
    maxCompressionRatio: 100,
  });

  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  measureWorkbookShape(workbook, {
    maxSheets: 8,
    maxRowsPerSheet: 10_000,
    maxCells: 50_000,
  });

  const values: unknown[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      {
        raw: false,
        defval: "",
      }
    );

    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (value !== "") values.push(value);
      }
    }
  }

  return values;
}

async function extractJsonValues(req: Request) {
  const body = await readJsonBodyWithinLimit<{
    imeisText?: unknown;
    imeis?: unknown;
  }>(req, MAX_JSON_BYTES);

  if (body?.imeisText !== undefined) return [body.imeisText];
  return Array.isArray(body?.imeis) ? body.imeis : [];
}

export async function POST(req: Request) {
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "outboundPreview", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const isMultipart = req.headers
      .get("content-type")
      ?.includes("multipart/form-data");
    const rawValues = isMultipart
      ? await extractWorkbookValues(req)
      : await extractJsonValues(req);
    const cleaned = collectImeisWithinLimit(rawValues);

    if (cleaned.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No valid 15-digit IMEI detected.",
          imeis: [],
          unknown_imeis: rawValues.slice(0, 100).map(String),
          already_out: [],
          duplicates: [],
          totalDetected: 0,
          summary: [],
        },
        { status: 400 }
      );
    }

    const counter = new Map<string, number>();
    for (const imei of cleaned) {
      counter.set(imei, (counter.get(imei) || 0) + 1);
    }

    const uniqueImeis = Array.from(counter.keys());
    const lookupQueries = Math.ceil(
      uniqueImeis.length / LOOKUP_BATCH_SIZE
    );
    if (lookupQueries + 2 > MAX_LOOKUP_QUERIES) {
      throw new PayloadTooLargeError(
        "Preview exceeds the database lookup budget"
      );
    }

    const duplicates = Array.from(counter.entries())
      .filter(([, count]) => count > 1)
      .map(([imei, count]) => ({ imei, count }));
    const supabase = supabaseService();
    const stockRows: any[] = [];

    for (const chunk of chunkArray(uniqueImeis, LOOKUP_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("stock_export_view")
        .select("item_id, imei, box_id, box_code, floor, device")
        .in("imei", chunk);

      if (error) throw error;
      stockRows.push(...(data || []));
    }

    const stockMap = new Map(
      stockRows.map((row: any) => [String(row.imei), row])
    );
    const missingImeis = uniqueImeis.filter((imei) => !stockMap.has(imei));
    let outRows: any[] = [];

    if (missingImeis.length > 0) {
      const { data, error } = await supabase.rpc(
        "get_latest_outbound_movements",
        { p_imeis: missingImeis }
      );
      if (error) throw error;
      outRows = data || [];
    }

    const outMap = new Map<string, any>();
    for (const row of outRows) {
      outMap.set(String(row.imei), row);
    }

    const valid: any[] = [];
    const already_out: any[] = [];
    const unknown_imeis: string[] = [];

    for (const imei of uniqueImeis) {
      const stockItem = stockMap.get(imei);
      if (stockItem) {
        valid.push(stockItem);
        continue;
      }

      const outItem = outMap.get(imei);
      if (outItem) {
        already_out.push({
          imei,
          device: outItem.device || "-",
          box: outItem.box_code || "-",
          floor: outItem.floor || "-",
          status: "OUT",
          shipment_ref: outItem.shipment_ref || "",
          source: outItem.source || "",
          created_at: outItem.created_at || "",
        });
      } else {
        unknown_imeis.push(imei);
      }
    }

    const summaryMap = new Map<string, any>();
    for (const item of valid) {
      const key = String(item.box_id || item.box_code || item.imei);
      const current = summaryMap.get(key) || {
        device: item.device || "",
        box_no: item.box_code || "",
        floor: item.floor || "",
        box_id: item.box_id,
        detected: 0,
        stock_before: 0,
        remaining: 0,
        percent_after: 0,
      };
      current.detected += 1;
      summaryMap.set(key, current);
    }

    const summary = Array.from(summaryMap.values());
    if (summary.length > MAX_PREVIEW_BOXES) {
      throw new PayloadTooLargeError(
        `A preview supports at most ${MAX_PREVIEW_BOXES} boxes`
      );
    }

    const boxIds = summary
      .map((row) => row.box_id)
      .filter((boxId): boxId is string => Boolean(boxId));
    if (boxIds.length > 0) {
      const { data, error } = await supabase.rpc(
        "get_outbound_box_stock_counts",
        { p_box_ids: boxIds }
      );
      if (error) throw error;

      const countMap = new Map<string, number>(
        (data || []).map((row: any) => [
          String(row.box_id),
          Number(row.stock_count || 0),
        ])
      );
      for (const row of summary) {
        const stock = countMap.get(String(row.box_id)) || 0;
        row.stock_before = stock;
        row.remaining = stock - row.detected;
        row.percent_after =
          stock > 0 ? Math.round((row.remaining / stock) * 100) : 0;
      }
    }

    const hasErrors =
      duplicates.length > 0 ||
      already_out.length > 0 ||
      unknown_imeis.length > 0;

    return NextResponse.json(
      {
        ok: !hasErrors,
        error: hasErrors
          ? "Confirm blocked. Please correct duplicate, unknown or already outbound IMEIs."
          : null,
        imeis: valid.map((item) => item.imei),
        unknown_imeis,
        already_out,
        duplicates,
        totalDetected: cleaned.length,
        summary,
      },
      { status: hasErrors ? 400 : 200 }
    );
  } catch (error) {
    const tooLarge = error instanceof PayloadTooLargeError;
    const invalid = error instanceof InvalidPreviewError || error instanceof SyntaxError;
    console.error("OUTBOUND PREVIEW ERROR", error);
    return NextResponse.json(
      {
        ok: false,
        error: tooLarge
          ? error.message
          : invalid && error instanceof Error
            ? error.message
            : "Preview failed",
      },
      { status: tooLarge ? 413 : invalid ? 400 : 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
