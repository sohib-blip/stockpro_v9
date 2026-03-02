import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const labels = body.labels;
    const w_mm = Number(body.w_mm ?? 100);
    const h_mm = Number(body.h_mm ?? 50);

    if (!Array.isArray(labels) || labels.length === 0) {
      return Response.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    const mmToPt = (mm: number) => mm * 2.83465;

    const doc = new PDFDocument({
      size: [mmToPt(w_mm), mmToPt(h_mm)],
      margin: 5,
      autoFirstPage: false,
    });

    const chunks: any[] = [];

    doc.on("data", (chunk) => {
      chunks.push(chunk);
    });

    for (const label of labels) {
      const imeis: string[] = (label?.imeis || [])
        .map((x: any) => String(x).replace(/\D/g, ""))
        .filter((x: string) => x.length === 15);

      for (const imei of imeis) {
        doc.addPage();

        const qr = await QRCode.toDataURL(imei);
        const base64 = qr.split(",")[1];
        const img = Buffer.from(base64, "base64");

        doc.image(img, 10, 10, {
          fit: [mmToPt(w_mm) - 20, mmToPt(h_mm) - 25],
          align: "center",
        });

        doc
          .font("Courier")
          .fontSize(10)
          .text(imei, 10, mmToPt(h_mm) - 18, {
            width: mmToPt(w_mm) - 20,
            align: "center",
          });
      }
    }

    doc.end();

    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on("end", () => {
        const merged = Buffer.concat(chunks);
        resolve(merged);
      });
      doc.on("error", reject);
    });

    // 👇 conversion en Blob = TypeScript happy
    const blob = new Blob([pdfBuffer as BlobPart], {
      type: "application/pdf",
    });

    return new Response(blob, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=labels.pdf",
      },
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "PDF generation failed" },
      { status: 500 }
    );
  }
}