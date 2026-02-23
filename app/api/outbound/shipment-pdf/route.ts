import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";

export const runtime = "nodejs"; // 🔥 IMPORTANT

export async function POST(req: Request) {
  try {
    const { imeis, shipment_ref } = await req.json();

    if (!imeis || !imeis.length) {
      return NextResponse.json(
        { ok: false, error: "No IMEIs provided" },
        { status: 400 }
      );
    }

    const doc = new PDFDocument();
    const chunks: Uint8Array[] = [];

    doc.on("data", (chunk) => {
      chunks.push(chunk);
    });

    doc.on("end", () => {});

    // 📄 CONTENT
    doc.fontSize(18).text("Shipment Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text("Shipment Ref: " + (shipment_ref || "N/A"));
    doc.moveDown();
    doc.text("IMEIs:");
    doc.moveDown();

    imeis.forEach((i: string) => {
      doc.text(i);
    });

    doc.end();

    await new Promise<void>((resolve) => {
      doc.on("end", () => resolve());
    });

    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          'attachment; filename="shipment_report.pdf"',
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}