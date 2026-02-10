import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function cleanImei(v: any): string | null {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const box_id = url.searchParams.get("box_id");
    if (!box_id) {
      return NextResponse.json({ ok: false, error: "Missing box_id" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const supabase = authedClient(token);

    // Box info (optional, juste pour affichage)
    const { data: box, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .eq("box_id", box_id)
      .single();

    if (boxErr) {
      return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    }

    const deviceName = String((box as any).device ?? "").trim();
    const boxNo = String((box as any).box_no ?? "").trim();

    // Fetch IMEIs
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("imei")
      .eq("box_id", box_id)
      .order("imei", { ascending: true });

    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
    }

    // ✅ QR DATA = IMEI ONLY, 1 PER LINE
    const imeis = Array.from(
      new Set((items ?? []).map((x: any) => cleanImei(x.imei)).filter(Boolean) as string[])
    );

    if (!imeis.length) {
      return NextResponse.json({ ok: false, error: "No valid IMEI found for this box" }, { status: 400 });
    }

    const qrData = imeis.join("\n"); // ✅ exact format demandé

    // PNG preview for browser (optionnel)
    const previewPng = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
    });

    return NextResponse.json({
      ok: true,
      box_id,
      box_no: boxNo,
      device: deviceName,
      qty: imeis.length,
      qr_data: qrData,        // ✅ IMEI-only
      previewPng,             // ✅ pour l’UI si tu veux afficher un preview
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}