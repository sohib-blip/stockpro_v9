import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

// mm -> PDF points (72 points / inch)
function mmToPt(mm: number) {
  return (mm / 25.4) * 72;
}

async function qrPngBuffer(text: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 6,
  });
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const batch_id = url.searchParams.get("batch_id");
    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    // ✅ Default label size for Zebra ZD220 stock labels
    // Common: 100x50mm (you can change via URL params)
    const w_mm = Number(url.searchParams.get("w_mm") || "100");
    const h_mm = Number(url.searchParams.get("h_mm") || "50");

    if (!Number.isFinite(w_mm) || !Number.isFinite(h_mm) || w_mm <= 0 || h_mm <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid w_mm / h_mm" }, { status: 400 });
    }

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);
    const M = mmToPt(3); // margin ~3mm

    const supabase = sb();

    // Get all IN movements for this inbound batch
    const { data: movs, error: movErr } = await supabase
      .from("movements")
      .select("imei, box_id, device_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (movErr) throw movErr;

    if (!movs || movs.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No IN movements found for this batch" },
        { status: 404 }
      );
    }

    // Device map
    const { data: devices } = await supabase.from("devices").select("device_id, device");
    const deviceMap: Record<string, string> = {};
    for (const d of devices || []) {
      deviceMap[String((d as any).device_id)] = String((d as any).device);
    }

    // Group IMEIs by box_id
    const byBox: Record<string, { device_id: string; imeis: string[] }> = {};
    for (const m of movs as any[]) {
      const box_id = String(m.box_id);
      if (!box_id) continue;
      if (!byBox[box_id]) byBox[box_id] = { device_id: String(m.device_id), imeis: [] };
      byBox[box_id].imeis.push(String(m.imei));
    }

    // PDF
    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [PAGE_W, PAGE_H],
      margin: 0,
    });

    const chunks: Uint8Array[] = [];
    doc.on("data", (c) => chunks.push(c));

    const boxIds = Object.keys(byBox);

    for (const box_id of boxIds) {
      const deviceName = deviceMap[byBox[box_id].device_id] || "UNKNOWN";
      const imeis = byBox[box_id].imeis;
      const qty = imeis.length;

      // QR content: ONLY imeis
      const qrContent = imeis.join("\n");
      const qrBuf = await qrPngBuffer(qrContent);

      doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      // Layout sizing (responsive to label size)
      // QR takes ~55% height for 100x50mm; fits nicely
      const qrSize = Math.min(contentW, contentH * 0.58);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = M;

      doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });

      let y = qrY + qrSize + mmToPt(1.5);

      // Device name
      doc
        .font("Helvetica-Bold")
        .fontSize(Math.max(9, Math.min(12, PAGE_H / 10)))
        .fillColor("#111111")
        .text(deviceName, M, y, { width: contentW, align: "center" });

      y += mmToPt(5);

      // Box ID
      doc
        .font("Helvetica")
        .fontSize(Math.max(7, Math.min(9, PAGE_H / 14)))
        .fillColor("#111111")
        .text(`BOX ID: ${box_id}`, M, y, { width: contentW, align: "center" });

      y += mmToPt(4.5);

      // Qty
      doc
        .font("Helvetica-Bold")
        .fontSize(Math.max(8, Math.min(11, PAGE_H / 12)))
        .fillColor("#111111")
        .text(`QTY IMEI: ${qty}`, M, y, { width: contentW, align: "center" });
    }

    doc.end();

    await new Promise<void>((resolve) => doc.on("end", resolve));

    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="ZD220_labels_${batch_id}_${w_mm}x${h_mm}mm.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Labels generation failed" },
      { status: 500 }
    );
  }
}