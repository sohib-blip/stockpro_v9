import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs";

function mmToPt(mm: number) {
  return (mm / 25.4) * 72;
}

async function qrBuffer(text: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 6,
  });

  const base64 = dataUrl.split(",")[1];
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

export async function POST(req: Request) {
  try {
    const { labels, w_mm = 105, h_mm = 155 } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);

    for (const label of labels) {
      const imeis: string[] = Array.from(
        new Set(
          (label.imeis || [])
            .map((x: string) => String(x).replace(/\D/g, ""))
            .filter((x: string) => x.length === 15)
        )
      );

      if (!imeis.length) continue;

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      const qrContent = imeis.join("\n");
      const qrBytes = await qrBuffer(qrContent);
      const qrImage = await pdfDoc.embedPng(qrBytes);

      const margin = mmToPt(5);
      const contentWidth = PAGE_W - margin * 2;

      const qrSize = Math.min(contentWidth, PAGE_H * 0.6);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = PAGE_H - qrSize - margin;

      page.drawImage(qrImage, {
        x: qrX,
        y: qrY,
        width: qrSize,
        height: qrSize,
      });

      let y = qrY - 20;

      // 🔥 FIX DEVICE NAME
      const deviceName =
        label.device ||
        label.device_name ||
        label.deviceName ||
        label.bin_id ||
        "UNKNOWN DEVICE";

      const boxNo =
        label.box_no ||
        label.boxNo ||
        label.box ||
        "";

      const qty = imeis.length;

      // Centered text helper
      function drawCentered(text: string, size: number, usedFont: any) {
        const textWidth = usedFont.widthOfTextAtSize(text, size);
        const x = (PAGE_W - textWidth) / 2;

        page.drawText(text, {
          x,
          y,
          size,
          font: usedFont,
        });
      }

      drawCentered(deviceName, 12, fontBold);
      y -= 16;

      drawCentered(`BOX: ${boxNo}`, 10, font);
      y -= 14;

      drawCentered(`QTY IMEI: ${qty}`, 10, font);
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

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