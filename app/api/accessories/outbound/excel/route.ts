import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  buildAccessoryEndOfDayPreview,
  DeviceAccessoryTemplate,
  EndOfDayStockItem,
} from "@/lib/outbound/accessoryEndOfDay";
import { parseEndOfDayWorkbook } from "@/lib/outbound/endOfDayParser";
import { accessoryReportOperationId } from "@/lib/outbound/reportFingerprint";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import {
  PayloadTooLargeError,
  readBodyWithinLimit,
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

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 256 * 1024;
const LOOKUP_BATCH_SIZE = 500;

class InvalidAccessoryReportError extends Error {}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function readReport(req: Request) {
  const requestBody = await readBodyWithinLimit(req, MAX_MULTIPART_BYTES);
  const form = await requestWithBoundedBody(req, requestBody).formData();
  const file = form.get("file");

  if (
    !file ||
    typeof file === "string" ||
    typeof file.arrayBuffer !== "function"
  ) {
    throw new InvalidAccessoryReportError("No spreadsheet uploaded.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new PayloadTooLargeError("Workbook exceeds the file-size limit");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  inspectXlsxZipEnvelope(buffer, {
    maxCompressedBytes: MAX_FILE_BYTES,
    maxExpandedBytes: 16 * 1024 * 1024,
    maxEntries: 128,
    maxEntryBytes: 8 * 1024 * 1024,
    maxCompressionRatio: 100,
  });

  const workbook = XLSX.read(buffer, { type: "buffer" });
  measureWorkbookShape(workbook, {
    maxSheets: 8,
    maxRowsPerSheet: 10_000,
    maxCells: 50_000,
  });

  return {
    form,
    buffer,
    report: parseEndOfDayWorkbook(workbook),
  };
}

export async function POST(req: Request) {
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "outboundPreview", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const { form, buffer, report } = await readReport(req);
    const preview = String(form.get("preview") || "") === "1";
    const shipmentRef = String(form.get("shipment_ref") || "");
    const comment = String(form.get("comment") || "");
    const requestedOperationId = String(form.get("operation_id") || "");
    const operationId = accessoryReportOperationId(buffer);
    const supabase = supabaseService();

    if (shipmentRef.length > 500 || comment.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "Invalid accessory outbound request" },
        { status: 400 }
      );
    }

    if (!preview && requestedOperationId !== operationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "The spreadsheet changed after preview. Preview it again before confirming.",
        },
        { status: 409 }
      );
    }

    const { data: existingReceipts, error: receiptError } = await supabase
      .from("inventory_command_receipts")
      .select("operation_id")
      .eq("operation_id", operationId)
      .limit(1);
    if (receiptError) throw receiptError;

    if ((existingReceipts || []).length > 0) {
      return NextResponse.json(
        {
          ok: false,
          duplicate_report: true,
          error:
            "This End-of-Day report has already been confirmed in Accessory Outbound. No stock was removed again.",
        },
        { status: 409 }
      );
    }

    const { data: accessoryBins, error: accessoryError } = await supabase
      .from("accessory_bins")
      .select("id, name, current_stock")
      .eq("active", true);
    if (accessoryError) throw accessoryError;

    const imeis = Array.from(new Set(report.devices.map((device) => device.imei)));
    const stockItems: EndOfDayStockItem[] = [];
    for (const chunk of chunkArray(imeis, LOOKUP_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("items")
        .select("imei, device_id")
        .in("imei", chunk);
      if (error) throw error;
      stockItems.push(...((data || []) as EndOfDayStockItem[]));
    }

    const deviceIds = Array.from(
      new Set(
        stockItems
          .map((item) => item.device_id)
          .filter((deviceId): deviceId is string => Boolean(deviceId))
      )
    );
    const templates: DeviceAccessoryTemplate[] = [];
    for (const chunk of chunkArray(deviceIds, LOOKUP_BATCH_SIZE)) {
      const { data, error } = await supabase
        .from("device_accessory_templates")
        .select("device_id, accessory_bin_id, quantity, per_devices")
        .in("device_id", chunk);
      if (error) throw error;
      templates.push(...((data || []) as DeviceAccessoryTemplate[]));
    }

    const calculation = buildAccessoryEndOfDayPreview({
      report,
      accessoryBins: accessoryBins || [],
      stockItems,
      templates,
    });

    if (calculation.issues.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: calculation.issues[0].message,
          issues: calculation.issues.slice(0, 100),
          rows: calculation.rows,
          parsed_sheets: report.parsedSheets,
        },
        { status: 400 }
      );
    }

    if (preview) {
      return NextResponse.json({
        ok: true,
        preview: true,
        operation_id: operationId,
        rows: calculation.rows,
        parsed_sheets: report.parsedSheets,
        device_rows: report.deviceRows,
        accessory_rows: report.accessories.length,
      });
    }

    const { data, error: commandError } = await supabase.rpc(
      "confirm_accessory_outbound",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_source: "excel",
        p_shipment_ref: shipmentRef || null,
        p_note: comment || null,
        p_lines: calculation.rows.map((row) => ({
          accessory_bin_id: row.accessory_bin_id,
          qty: row.qty,
        })),
      }
    );

    if (commandError) {
      console.error("EXCEL ACCESSORY COMMAND ERROR", commandError);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            commandError,
            "Spreadsheet outbound failed"
          ),
        },
        { status: inventoryCommandErrorStatus(commandError) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    const tooLarge = error instanceof PayloadTooLargeError;
    const invalid =
      error instanceof InvalidAccessoryReportError || error instanceof SyntaxError;
    console.error("EXCEL ACCESSORY OUTBOUND ERROR", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error && (tooLarge || invalid)
            ? error.message
            : "Spreadsheet outbound failed",
      },
      { status: tooLarge ? 413 : invalid ? 400 : 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
