import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";

const MAX_SHIPMENT_IMEIS = 2_000;
const MAX_SHIPMENT_BODY_BYTES = 128 * 1024;
const MAX_SHIPMENT_PDF_BYTES = 8 * 1024 * 1024;

const shipmentSchema = z.object({
  imeis: z
    .array(z.string().trim().regex(/^\d{15}$/))
    .min(1)
    .max(MAX_SHIPMENT_IMEIS),
  shipment_ref: z.string().trim().max(100).nullish(),
});

export async function POST(req: Request) {
  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBodyWithinLimit(
      req,
      MAX_SHIPMENT_BODY_BYTES
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof PayloadTooLargeError
            ? "Shipment request is too large"
            : "Invalid shipment request",
      },
      { status: error instanceof PayloadTooLargeError ? 413 : 400 }
    );
  }

  const parsed = shipmentSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Provide between 1 and ${MAX_SHIPMENT_IMEIS} valid IMEIs`,
      },
      { status: 400 }
    );
  }

  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "shipmentPdf", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];

    const completed = new Promise<void>((resolve, reject) => {
      doc.on("data", (chunk: Buffer | Uint8Array) => {
        chunks.push(Buffer.from(chunk));
      });
      doc.once("end", resolve);
      doc.once("error", reject);
    });

    doc.fontSize(18).text("Shipment Report", { align: "center" });
    doc.moveDown();
    doc
      .fontSize(12)
      .text("Shipment Ref: " + (parsed.data.shipment_ref || "N/A"));
    doc.moveDown();
    doc.text("IMEIs:");
    doc.moveDown();

    for (const imei of parsed.data.imeis) {
      doc.text(imei);
    }

    doc.end();
    await completed;

    const pdfBuffer = Buffer.concat(chunks);
    if (pdfBuffer.length > MAX_SHIPMENT_PDF_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Generated shipment document is too large" },
        { status: 413 }
      );
    }

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="shipment_report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("SHIPMENT PDF ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Shipment document generation failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
