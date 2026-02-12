// app/api/inbound/manual-cabinet/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function uniq(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) if (x && !seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

function makeAutoBoxNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `CABINET-RETURN-${y}${m}${day}-${hh}${mm}`;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const user = authedClient(token);
    const { error: authErr } = await user.auth.getUser();
    if (authErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const device = String(body.device || "").trim();
    const imeis = uniq((Array.isArray(body.imeis) ? body.imeis : []).map((x: any) => String(x).replace(/\D/g, "")))
      .filter((x) => /^\d{14,17}$/.test(x));

    if (!device) return NextResponse.json({ ok: false, error: "Device required" }, { status: 400 });
    if (imeis.length === 0) return NextResponse.json({ ok: false, error: "No valid IMEIs" }, { status: 400 });

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });

    const { data: devRow, error: devErr } = await admin.from("devices").select("device_id").eq("device", device).maybeSingle();
    if (devErr) throw new Error(devErr.message);
    const device_id = devRow?.device_id;
    if (!device_id) return NextResponse.json({ ok: false, error: `Device not found: ${device}` }, { status: 400 });

    const { data: existing, error: exErr } = await admin.from("items").select("imei").in("imei", imeis);
    if (exErr) throw new Error(exErr.message);
    if ((existing || []).length > 0) {
      return NextResponse.json(
        { ok: false, error: "Duplicate IMEIs detected", duplicates: (existing || []).map((x: any) => x.imei) },
        { status: 400 }
      );
    }

    const box_no = makeAutoBoxNo();
    const location = "CABINET";
    const qr_payload = imeis.join("\n");

    const { data: boxRow, error: boxErr } = await admin
      .from("boxes")
      .insert({ device_id, box_no, location, status: "IN", qr_payload, qty: imeis.length })
      .select("box_id")
      .maybeSingle();
    if (boxErr) throw new Error(boxErr.message);

    const box_id = boxRow?.box_id as string;

    const rows = imeis.map((imei) => ({ imei, box_id, device_id, status: "IN" }));
    const { error: insErr } = await admin.from("items").insert(rows);
    if (insErr) throw new Error(insErr.message);

    return NextResponse.json({ ok: true, inserted: rows.length, box_no, box_id, location });
  } catch (e: any) {
    console.error("Manual cabinet import error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}