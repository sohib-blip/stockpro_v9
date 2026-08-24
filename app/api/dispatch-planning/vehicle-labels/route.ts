import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getApiIdentity } from "@/lib/api-identity";
import { parseDispatchWorkbook } from "@/lib/dispatch-planning";
import {
  buildDispatchVehicleLabels,
  createDispatchVehicleLabelsDocx,
} from "@/lib/dispatch-vehicle-labels";
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
const MAX_LINES = 10_000;
const MAX_LABELS = 10_000;
const MAX_DOCX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "dispatchLabels", {
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
    const labelResult = buildDispatchVehicleLabels(parsed.lines);
    const issues = [...parsed.issues, ...labelResult.issues];
    if (issues.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "The workbook contains unknown or incomplete device rows. Vehicle labels were not generated.",
          issues: issues.slice(0, 100),
        },
        { status: 400 }
      );
    }
    if (labelResult.labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No device vehicle registrations were found." },
        { status: 400 }
      );
    }
    if (labelResult.labels.length > MAX_LABELS) {
      throw new PayloadTooLargeError(
        `A label download supports at most ${MAX_LABELS} devices.`
      );
    }

    const docx = await createDispatchVehicleLabelsDocx(labelResult.labels);
    if (docx.length > MAX_DOCX_BYTES) {
      throw new PayloadTooLargeError("Generated label Word document is too large.");
    }

    return new NextResponse(new Uint8Array(docx), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition":
          'attachment; filename="vehicle-registration-labels-L4731.docx"',
        "Cache-Control": "no-store",
        "X-StockPro-Label-Count": String(labelResult.labels.length),
      },
    });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 413 }
      );
    }
    console.error("DISPATCH VEHICLE LABELS ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Vehicle label generation failed." },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
