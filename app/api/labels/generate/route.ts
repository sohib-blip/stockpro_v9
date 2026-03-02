import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export const runtime = "nodejs";

function mmToPt(mm: number) {
  return (mm / 25.4) * 72;
}

async function qrBuffer(text: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 6,
  });

  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

export async function POST(req: Request) {
  try {
    const { labels, w_mm = 100, h_mm = 50 } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    const PAGE_W = mmToPt(Number(w_mm));
    const PAGE_H = mmToPt(Number(h_mm));
    const M = mmToPt(3);

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [PAGE_W, PAGE_H],
      margin: 0,
    });

    const chunks: Uint8Array[] = [];
    doc.on("data", (c) => chunks.push(c));

    for (const label of labels) {
      const imeis: string[] = (label.imeis || [])
        .map((x: string) => x.replace(/\D/g, ""))
        .filter((x: string) => x.length === 15);

      if (!imeis.length) continue;

      const qrContent = imeis.join("\n");
      const qr = await qrBuffer(qrContent);

      doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      const qrSize = Math.min(contentW, contentH * 0.6);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = M;

      doc.image(qr, qrX, qrY, {
        width: qrSize,
        height: qrSize,
      });

      let y = qrY + qrSize + mmToPt(2);

      // ⚠️ PAS DE .font()
      doc.fontSize(11).text(label.device || "UNKNOWN DEVICE", M, y, {
        width: contentW,
        align: "center",
      });

      y += mmToPt(5);

      doc.fontSize(9).text(`BOX: ${label.box_no}`, M, y, {
        width: contentW,
        align: "center",
      });

      y += mmToPt(4);

      doc.fontSize(9).text(`QTY IMEI: ${imeis.length}`, M, y, {
        width: contentW,
        align: "center",
      });
    }

    doc.end();

    await new Promise<void>((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=labels.pdf",
      },
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Generation failed" },
      { status: 500 }
    );
  }
}