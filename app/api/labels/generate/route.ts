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
    const body = await req.json();
    const labels = body.labels;
    const w_mm = Number(body.w_mm ?? 100);
    const h_mm = Number(body.h_mm ?? 50);

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ ok: false, error: "No labels provided" }, { status: 400 });
    }

    if (!Number.isFinite(w_mm) || !Number.isFinite(h_mm) || w_mm <= 0 || h_mm <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid w_mm / h_mm" }, { status: 400 });
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

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

      if (imeis.length === 0) continue;

      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

      // QR contient UNIQUEMENT les IMEIs ligne par ligne
      const qrContent = imeis.join("\n");
      const qrBytes = await qrBuffer(qrContent);
      const qrImage = await pdfDoc.embedPng(qrBytes);

      const M = mmToPt(3);
      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      const qrSize = Math.min(contentW, contentH * 0.6);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = PAGE_H - M - qrSize;

      page.drawImage(qrImage, {
        x: qrX,
        y: qrY,
        width: qrSize,
        height: qrSize,
      });

      // Text sous le QR : device, box id, qty
      let y = qrY - mmToPt(3);

      const deviceName = String(label.device || "UNKNOWN DEVICE");
      const boxNo = String(label.box_no || label.boxNo || label.box || "");
      const qty = imeis.length;

      page.drawText(deviceName, {
        x: M,
        y,
        size: 11,
        font,
      });

      y -= 14;

      page.drawText(`BOX: ${boxNo}`, {
        x: M,
        y,
        size: 9,
        font,
      });

      y -= 14;

      page.drawText(`QTY IMEI: ${qty}`, {
        x: M,
        y,
        size: 9,
        font,
      });
    }

    const pdfBytes = await pdfDoc.save();

    // ✅ FIX: convertir Uint8Array -> Buffer pour NextResponse (plus d’erreur rouge)
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