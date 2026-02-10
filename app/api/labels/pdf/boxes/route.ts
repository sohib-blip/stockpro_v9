import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export const runtime = "nodejs";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

const mm = (v: number) => (72 / 25.4) * v;

// ~ 60mm x 40mm
const PAGE_W = mm(60);
const PAGE_H = mm(40);

function base64ToUint8Array(base64: string) {
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

type PdfBox = { device: string; box_no: string; qr_data: string };

async function makePdfFromBoxes(boxes: PdfBox[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const b of boxes) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);

    const pngDataUrl = await QRCode.toDataURL(b.qr_data, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
    });

    const base64 = pngDataUrl.split(",")[1] || "";
    const pngBytes = base64ToUint8Array(base64);
    const png = await pdf.embedPng(pngBytes);

    const qrSize = mm(28);
    const qrX = mm(4);
    const qrY = PAGE_H - qrSize - mm(4);

    page.drawImage(png, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    const textX = qrX + qrSize + mm(4);

    page.drawText(String(b.device || "").slice(0, 28), {
      x: textX,
      y: PAGE_H - mm(10),
      size: 12,
      font,
    });

    page.drawText(`Box: ${String(b.box_no || "")}`.slice(0, 28), {
      x: textX,
      y: PAGE_H - mm(18),
      size: 10,
      font,
    });
  }

  return pdf.save(); // Uint8Array
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const body = await req.json().catch(() => null);
    const box_ids: string[] = Array.isArray(body?.box_ids) ? body.box_ids : [];
    if (!box_ids.length) return NextResponse.json({ ok: false, error: "Missing box_ids" }, { status: 400 });

    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_id", box_ids);

    if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });

    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("box_id, imei")
      .in("box_id", box_ids)
      .order("imei", { ascending: true });

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

    const imeiMap = new Map<string, string[]>();
    for (const it of items || []) {
      const bid = String((it as any).box_id);
      const imei = String((it as any).imei ?? "").replace(/\D/g, "");
      if (imei.length !== 15) continue;
      if (!imeiMap.has(bid)) imeiMap.set(bid, []);
      imeiMap.get(bid)!.push(imei);
    }

    const payload: PdfBox[] = (boxes || [])
      .map((b: any) => {
        const bid = String(b.box_id);
        const imeis = Array.from(new Set(imeiMap.get(bid) || []));
        return {
          device: String(b.device ?? "").trim(),
          box_no: String(b.box_no ?? "").trim(),
          qr_data: imeis.join("\n"), // ✅ IMEI only, 1 per line
        };
      })
      .filter((x) => x.device && x.box_no && x.qr_data);

    if (!payload.length) {
      return NextResponse.json({ ok: false, error: "No printable labels found for these box_ids" }, { status: 400 });
    }

    const pdfBytes = await makePdfFromBoxes(payload);

    // ✅ IMPORTANT: renvoyer un Buffer = 100% OK pour Response/Next (et TS)
    const buf = Buffer.from(pdfBytes);

    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="labels-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}