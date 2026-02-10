import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

const s = (v: any) => String(v ?? "");
const trim = (v: any) => s(v).trim();

function canonicalize(v: any) {
  return s(v).toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function parseImeis(input: any): string[] {
  // accept array or multi-line string
  if (Array.isArray(input)) {
    return input.map((x) => s(x).replace(/\D/g, "")).filter((x) => x.length === 15);
  }
  const lines = s(input).split(/\r?\n/);
  const out: string[] = [];
  for (const ln of lines) {
    const digits = ln.replace(/\D/g, "");
    if (digits.length === 15) out.push(digits);
  }
  return out;
}

async function resolveDeviceDisplayOrNull(admin: any, rawDevice: string) {
  const rawCanon = canonicalize(rawDevice);
  if (!rawCanon) return null;

  const { data, error } = await admin.from("devices").select("canonical_name, device, active");
  if (error) return null;

  const active = (data || []).filter((d: any) => d.active !== false);

  // exact canonical
  const exact = active.find((d: any) => String(d.canonical_name || "") === rawCanon);
  if (exact) return String(exact.device || exact.canonical_name);

  // longest prefix match
  let best: any = null;
  for (const d of active) {
    const dbCanon = String(d.canonical_name || "");
    if (!dbCanon) continue;
    if (rawCanon.startsWith(dbCanon)) {
      if (!best || dbCanon.length > String(best.canonical_name).length) best = d;
    }
  }
  if (best) return String(best.device || best.canonical_name);

  // FMC9202... -> FMC920
  const m3 = rawCanon.match(/^([A-Z]+)(\d{3})/);
  if (m3) {
    const short = m3[1] + m3[2];
    const f = active.find((d: any) => String(d.canonical_name || "") === short);
    if (f) return String(f.device || f.canonical_name);
  }

  // FMC 03 -> FMC003
  const mPad = rawCanon.match(/^([A-Z]+)(\d{1,2})$/);
  if (mPad) {
    const padded = mPad[1] + mPad[2].padStart(3, "0");
    const f = active.find((d: any) => String(d.canonical_name || "") === padded);
    if (f) return String(f.device || f.canonical_name);
  }

  return null;
}

async function ensureBox(admin: any, device: string, box_no: string, location: string) {
  // upsert by device + master_box_no
  const payload = {
    device,
    master_box_no: box_no,
    box_no,
    location,
    status: "IN_STOCK",
  };

  const up = await admin
    .from("boxes")
    .upsert(payload, { onConflict: "device,master_box_no" })
    .select("box_id, device, master_box_no, box_no")
    .maybeSingle();

  if (!up.error && up.data?.box_id) return String(up.data.box_id);

  // fallback: try insert then fetch
  await admin.from("boxes").insert(payload);

  const fetch = await admin
    .from("boxes")
    .select("box_id")
    .eq("device", device)
    .eq("master_box_no", box_no)
    .maybeSingle();

  if (fetch.error || !fetch.data?.box_id) return null;
  return String(fetch.data.box_id);
}

async function insertImeis(admin: any, box_id: string, imeis: string[]) {
  const uniq = Array.from(new Set(imeis));
  if (!uniq.length) return { inserted: 0, table: null as string | null };

  // try items first
  const r1 = await admin.from("items").insert(uniq.map((imei) => ({ box_id, imei, status: "IN_STOCK" })));
  if (!r1.error) return { inserted: uniq.length, table: "items" };

  // fallback box_items
  const r2 = await admin.from("box_items").insert(uniq.map((imei) => ({ box_id, imei })));
  if (!r2.error) return { inserted: uniq.length, table: "box_items" };

  return { inserted: 0, table: null };
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { data: uData, error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const created_by_email = uData.user?.email || null;

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });

    const rawDevice = trim(body.device);
    const box_no = trim(body.box_no);
    const location = trim(body.location || "00");
    const import_to_stock = Boolean(body.import_to_stock);
    const imeis = parseImeis(body.imeis);

    if (!rawDevice) return NextResponse.json({ ok: false, error: "Missing device" }, { status: 400 });
    if (!box_no) return NextResponse.json({ ok: false, error: "Missing box_no" }, { status: 400 });

    const deviceDisplay = await resolveDeviceDisplayOrNull(admin, rawDevice);
    if (!deviceDisplay) {
      return NextResponse.json(
        {
          ok: false,
          error: "device(s) not found in Admin > Devices",
          unknown_devices: [rawDevice],
        },
        { status: 400 }
      );
    }

    const uniqImeis = Array.from(new Set(imeis));
    const qr_data = uniqImeis.join("\n"); // ✅ QR content = IMEI only, one per line

    // If user only wants label (no import)
    if (!import_to_stock) {
      return NextResponse.json({
        ok: true,
        imported: false,
        device: deviceDisplay,
        box_no,
        qty: uniqImeis.length,
        qr_data,
        box_id: null,
      });
    }

    // Import to stock
    const box_id = await ensureBox(admin, deviceDisplay, box_no, location);
    if (!box_id) return NextResponse.json({ ok: false, error: "Could not create/fetch box_id" }, { status: 500 });

    const ins = await insertImeis(admin, box_id, uniqImeis);

    // ✅ Write history: inbound_import_logs + inbound_import_log_boxes
    const log = await admin
      .from("inbound_import_logs")
      .insert({
        vendor: "labels",
        location,
        file_name: null,
        created_by_email,
        devices: 1,
        boxes: 1,
        items: uniqImeis.length,
      })
      .select("id")
      .single();

    let history_warning: string | null = null;
    if (log.error) {
      history_warning = `History log failed: ${log.error.message}`;
    } else {
      const hist = await admin.from("inbound_import_log_boxes").insert({
        import_id: log.data.id,
        box_id,
        device: deviceDisplay,
        box_no,
        qty: uniqImeis.length,
      });
      if (hist.error) history_warning = `History boxes failed: ${hist.error.message}`;
    }

    return NextResponse.json({
      ok: true,
      imported: true,
      device: deviceDisplay,
      box_no,
      qty: uniqImeis.length,
      qr_data,
      box_id,
      inserted_into: ins.table,
      inserted_items: ins.inserted,
      history_warning,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}