import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs"; // 🔴 OBLIGATOIRE pour pdf-lib + Buffer

type LabelInput = {
  device: string;
  box_no: string;
  qr_data: string; // IMEI only, 1 per line
};

// 60mm x 40mm (label standard)
const mmToPt = (mm: number) => (mm * 72) / 25.4;
const PAGE_W = mmToPt(60);
const PAGE_H = mmToPt(40);

async function makeLabelPdf(labels: LabelInput[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const l of labels) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    const device = String(l.device ?? "").trim();
    const boxNo = String(l.box_no ?? "").trim();
    const qrData = String(l.qr_data ?? "").trim();

    // --- QR code (PNG) ---
    const dataUrl = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
    });

    const base64 = dataUrl.split(",")[1];
    const pngBytes = Buffer.from(base64, "base64");
    const png = await pdf.embedPng(pngBytes);

    const padding = 8;
    const qrSize = PAGE_H - padding * 2;

    // QR
    page.drawImage(png, {
      x: padding,
      y: padding,
      width: qrSize,
      height: qrSize,
    });

    // Text
    const textX = padding + qrSize + 10;
    const topY = PAGE_H - padding - 10;

    page.drawText(device, {
      x: textX,
      y: topY - 12,
      size: 14,
      font: fontBold,
    });

    page.drawText(`Box: ${boxNo}`, {
      x: textX,
      y: topY - 32,
      size: 12,
      font,
    });
  }

  // ⚠️ pdf-lib retourne Uint8Array
  return await pdf.save();
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const labels: LabelInput[] = Array.isArray(body?.labels) ? body.labels : [];
    if (!labels.length) {
      return NextResponse.json(
        { ok: false, error: "Missing labels[]" },
        { status: 400 }
      );
    }

    const cleaned = labels
      .map((l) => ({
        device: String(l.device ?? "").trim(),
        box_no: String(l.box_no ?? "").trim(),
        qr_data: String(l.qr_data ?? "").trim(),
      }))
      .filter((l) => l.device && l.box_no && l.qr_data);

    if (!cleaned.length) {
      return NextResponse.json(
        { ok: false, error: "No valid labels" },
        { status: 400 }
      );
    }

    const pdfBytes = await makeLabelPdf(cleaned);

    // ✅ FIX IMPORTANT : Uint8Array -> Buffer
    const buffer = Buffer.from(pdfBytes);

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="labels.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}