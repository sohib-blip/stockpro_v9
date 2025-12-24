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

// Zebra ZD220: 203 dpi. We'll use 4x6cm-ish default label.
// You can tweak later.
function buildZpl({ qrData, device, boxNo }: { qrData: string; device: string; boxNo: string }) {
  // QR code in ZPL: ^BQN (2D QR)
  // ^BQN,2,8 means model2, magnification 8
  // Position: ^FOx,y
  return `
^XA
^PW600
^LL400
^CI28

^FO30,30
^BQN,2,8
^FDLA,${qrData}^FS

^FO320,70
^A0N,35,35
^FD${device}^FS

^FO320,120
^A0N,30,30
^FDBox: ${boxNo}^FS

^XZ
`.trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const box_id = url.searchParams.get("box_id");
    if (!box_id) return NextResponse.json({ ok: false, error: "Missing box_id" }, { status: 400 });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    // Get box + device (we mainly use boxes.device ...)
    const { data: box, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .eq("box_id", box_id)
      .single();

    if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });

    const deviceName = String((box as any).device ?? "");
    const boxNo = String((box as any).box_no ?? "");

    // Get IMEIs for that box
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("imei")
      .eq("box_id", box_id)
      .order("imei", { ascending: true });

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

    const imeis = (items ?? []).map((x: any) => x.imei);
    const qrData = `BOX:${boxNo}|DEV:${deviceName}|IMEI:${imeis.join(",")}`;

    // PNG preview for browser
    const previewPng = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
    });

    const zpl = buildZpl({ qrData, device: deviceName, boxNo });

    return NextResponse.json({
      ok: true,
      box_id,
      box_no: boxNo,
      device: deviceName,
      qty: imeis.length,
      qrDataLength: qrData.length,
      previewPng,
      zpl,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
