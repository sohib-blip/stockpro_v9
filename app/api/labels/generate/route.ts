import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

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

type LabelInput = {
  // NEW SYSTEM (preferred)
  device_id?: string; // bin_id uuid
  // OLD SYSTEM fallback
  device?: string; // string name

  box: string; // box id/no text
  imeis: string[];
};

function cleanImeis(arr: any): string[] {
  const list = Array.isArray(arr) ? arr : [];
  const cleaned = list
    .map((x) => String(x ?? "").replace(/\D/g, ""))
    .filter((x) => x.length === 15);
  return Array.from(new Set(cleaned));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const w_mm = Number(body?.w_mm ?? 100);
    const h_mm = Number(body?.h_mm ?? 50);

    const labels = Array.isArray(body?.labels) ? (body.labels as LabelInput[]) : [];

    if (!Number.isFinite(w_mm) || !Number.isFinite(h_mm) || w_mm <= 0 || h_mm <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid w_mm/h_mm" }, { status: 400 });
    }
    if (labels.length === 0) {
      return NextResponse.json({ ok: false, error: "No labels provided" }, { status: 400 });
    }

    // --- Collect bin ids we need to resolve
    const binIds = Array.from(
      new Set(
        labels
          .map((l) => String(l?.device_id || "").trim())
          .filter((x) => x.length > 0)
      )
    );

    // --- Resolve bins -> name (only if device_id provided)
    const binNameById: Record<string, string> = {};
    if (binIds.length > 0) {
      const supabase = sb();
      const { data, error } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", binIds);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      for (const b of data || []) {
        binNameById[String((b as any).id)] = String((b as any).name || "");
      }
    }

    // Validate + clean + normalize
    const normalized: Array<{ device: string; box: string; imeis: string[] }> = [];

    for (const l of labels) {
      const device_id = String(l?.device_id || "").trim();
      const deviceFallback = String(l?.device || "").trim(); // old system
      const deviceName = device_id ? (binNameById[device_id] || "") : deviceFallback;

      const box = String(l?.box || "").trim();
      const imeis = cleanImeis(l?.imeis);

      if (!deviceName) continue;
      if (!box) continue;
      if (imeis.length === 0) continue;

      normalized.push({ device: deviceName, box, imeis });
    }

    if (normalized.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid labels (need device_id or device, box, at least 1 valid 15-digit IMEI)" },
        { status: 400 }
      );
    }

    const PAGE_W = mmToPt(w_mm);
    const PAGE_H = mmToPt(h_mm);
    const M = mmToPt(3);

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: [PAGE_W, PAGE_H],
      margin: 0,
    });

    const chunks: Uint8Array[] = [];
    doc.on("data", (c) => chunks.push(c));

    for (const l of normalized) {
      const qty = l.imeis.length;
      const qrContent = l.imeis.join("\n"); // ONLY imeis, one per line
      const qrBuf = await qrPngBuffer(qrContent);

      doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

      const contentW = PAGE_W - M * 2;
      const contentH = PAGE_H - M * 2;

      const qrSize = Math.min(contentW, contentH * 0.58);
      const qrX = (PAGE_W - qrSize) / 2;
      const qrY = M;

      doc.image(qrBuf, qrX, qrY, { width: qrSize, height: qrSize });

      let y = qrY + qrSize + mmToPt(1.5);

      doc
        .font("Helvetica-Bold")
        .fontSize(Math.max(9, Math.min(12, PAGE_H / 10)))
        .fillColor("#111111")
        .text(l.device, M, y, { width: contentW, align: "center" });

      y += mmToPt(5);

      doc
        .font("Helvetica")
        .fontSize(Math.max(7, Math.min(9, PAGE_H / 14)))
        .fillColor("#111111")
        .text(`BOX: ${l.box}`, M, y, { width: contentW, align: "center" });

      y += mmToPt(4.5);

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
        "Content-Disposition": `attachment; filename="labels_${w_mm}x${h_mm}mm.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Label generation failed" },
      { status: 500 }
    );
  }
}