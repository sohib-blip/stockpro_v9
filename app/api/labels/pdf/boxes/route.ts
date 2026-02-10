import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { detectSessionInUrl: false },
  });
}

// ZD220 203dpi, label canvas: 600x400 dots
// Convert to inches: dots/dpi => inches, then to PDF points (72/inch)
const DPI = 203;
const W_DOTS = 600;
const H_DOTS = 400;
const PAGE_W = (W_DOTS / DPI) * 72;
const PAGE_H = (H_DOTS / DPI) * 72;

function dataUrlToUint8(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || "";
  const bin = Buffer.from(base64, "base64");
  return new Uint8Array(bin);
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // security gate
    const userClient = authedClient(token);
    const { error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const box_ids: string[] = Array.isArray(body?.box_ids) ? body.box_ids : [];
    if (!box_ids.length) return NextResponse.json({ ok: false, error: "Missing box_ids" }, { status: 400 });

    // Load boxes
    const b = await admin
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_id", box_ids);

    if (b.error) return NextResponse.json({ ok: false, error: b.error.message }, { status: 400 });

    const boxes = (b.data || []).map((x: any) => ({
      box_id: String(x.box_id),
      box_no: String(x.box_no ?? ""),
      device: String(x.device ?? ""),
    }));

    // Load items for those boxes
    const it = await admin
      .from("items")
      .select("box_id, imei")
      .in("box_id", box_ids)
      .order("imei", { ascending: true });

    if (it.error) return NextResponse.json({ ok: false, error: it.error.message }, { status: 400 });

    const items = it.data || [];
    const mapImeis = new Map<string, string[]>();
    for (const row of items as any[]) {
      const bid = String(row.box_id);
      const imei = String(row.imei ?? "").replace(/\D/g, "");
      if (imei.length !== 15) continue;
      if (!mapImeis.has(bid)) mapImeis.set(bid, []);
      mapImeis.get(bid)!.push(imei);
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    for (const box of boxes) {
      const imeis = Array.from(new Set(mapImeis.get(box.box_id) || []));
      const qrData = imeis.join("\n"); // ✅ IMEI only, 1 per line

      // QR PNG
      const qrPngDataUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 6,
      });
      const qrPngBytes = dataUrlToUint8(qrPngDataUrl);
      const qrImg = await pdf.embedPng(qrPngBytes);

      const page = pdf.addPage([PAGE_W, PAGE_H]);

      // Layout close to your ZPL:
      // left QR block, right text block
      const margin = 8;
      const qrSize = PAGE_H - margin * 2; // square, full height-ish
      const qrX = margin;
      const qrY = margin;

      page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });

      const textX = qrX + qrSize + 10;
      const topY = PAGE_H - 22;

      // Device name
      page.drawText(box.device || "—", {
        x: textX,
        y: topY,
        size: 14,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      // Box label
      page.drawText(`Box: ${box.box_no || "—"}`, {
        x: textX,
        y: topY - 18,
        size: 12,
        font: font,
        color: rgb(0, 0, 0),
      });

      // Qty
      page.drawText(`Qty: ${imeis.length}`, {
        x: textX,
        y: topY - 34,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="labels-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}