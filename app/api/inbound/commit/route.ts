// app/api/inbound/commit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

const ITEMS_TABLE = "items";
const BOXES_TABLE = "boxes";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function findExistingImeis(admin: any, imeis: string[]) {
  const uniqueImeis = Array.from(new Set(imeis));
  const existing = new Set<string>();
  for (const part of chunk(uniqueImeis, 500)) {
    const { data, error } = await admin.from(ITEMS_TABLE).select("imei").in("imei", part);
    if (error) throw new Error(error.message);
    for (const r of data || []) existing.add(String(r.imei));
  }
  return existing;
}

async function getDeviceIdByDisplay(admin: any, deviceDisplay: string) {
  // devices.device = display que tu montres dans menu
  const { data, error } = await admin.from("devices").select("device_id").eq("device", deviceDisplay).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.device_id ?? null;
}

async function upsertBox(admin: any, payload: { device_id: string; box_no: string; location: string; qr_payload: string; qty: number }) {
  // unique index recommandé: (device_id, box_no, location)
  const { data, error } = await admin
    .from(BOXES_TABLE)
    .upsert(
      {
        device_id: payload.device_id,
        box_no: payload.box_no,
        location: payload.location,
        status: "IN",
        qr_payload: payload.qr_payload,
        qty: payload.qty,
      },
      { onConflict: "device_id,box_no,location" }
    )
    .select("box_id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.box_id as string;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = (form.get("vendor") as Vendor | null) ?? null;
    const location = String(form.get("location") || "").trim() || "00";
    if (!file || !vendor) return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });

    const { data: devicesDbRows, error: devErr } = await admin.from("devices").select("canonical_name, device, active");
    if (devErr) throw new Error(devErr.message);

    const devicesDb = toDeviceMatchList(devicesDbRows || []);
    const parsed = parseVendorExcel(vendor, bytes, devicesDb);
    if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

    const incomingImeis = parsed.labels.flatMap((l) => l.imeis || []);
    const existing = await findExistingImeis(admin, incomingImeis);
    if (existing.size > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Doublons IMEI détectés (${existing.size}). Import bloqué.`,
          duplicates_sample: Array.from(existing).slice(0, 25),
        },
        { status: 400 }
      );
    }

    // ✅ commit
    let boxesInserted = 0;
    let itemsInserted = 0;

    for (const l of parsed.labels) {
      const deviceDisplay = String(l.device || "").trim();
      const boxNo = String(l.box_no || "").trim();
      const imeis = Array.from(new Set((l.imeis || []).map(String))).filter(Boolean);

      const device_id = await getDeviceIdByDisplay(admin, deviceDisplay);
      if (!device_id) {
        return NextResponse.json(
          { ok: false, error: `Device introuvable dans Devices: ${deviceDisplay}` },
          { status: 400 }
        );
      }

      const qr_payload = imeis.join("\n");
      const box_id = await upsertBox(admin, { device_id, box_no: boxNo, location, qr_payload, qty: imeis.length });
      boxesInserted += 1;

      const rowsToInsert = imeis.map((imei) => ({
        imei,
        box_id,
        device_id,
        status: "IN",
      }));

      for (const part of chunk(rowsToInsert, 500)) {
        const { error } = await admin.from(ITEMS_TABLE).insert(part);
        if (error) throw new Error(error.message);
        itemsInserted += part.length;
      }
    }

    return NextResponse.json({
      ok: true,
      counts: parsed.counts,
      committed: { boxes: boxesInserted, items: itemsInserted },
    });
  } catch (e: any) {
    console.error("Inbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}