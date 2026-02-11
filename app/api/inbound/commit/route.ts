// app/api/inbound/commit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

/* =========================
   CONFIG DB
========================= */
const ITEMS_TABLE = "items";
const ITEMS_IMEI_COL = "imei";
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_DEVICE_ID_COL = "device_id";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_BOXNO_COL = "box_no";
const BOXES_LOCATION_COL = "location";
const BOXES_DEVICE_ID_COL = "device_id";
const BOXES_DEVICE_COL = "device";

/* =========================
   Supabase helpers
========================= */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   Duplicate check (IMEI)
========================= */
async function findExistingImeis(
  admin: NonNullable<ReturnType<typeof adminClient>>,
  imeis: string[]
) {
  const result = new Map<string, { box_no?: string | null; location?: string | null }>();

  const uniqueImeis = Array.from(new Set(imeis));
  if (uniqueImeis.length === 0) return result;

  const chunks = chunk(uniqueImeis, 500);

  for (const part of chunks) {
    const { data, error } = await admin
      .from(ITEMS_TABLE)
      .select(`${ITEMS_IMEI_COL}, ${ITEMS_BOX_ID_COL}`)
      .in(ITEMS_IMEI_COL, part);

    if (error) throw new Error(error.message);

    const boxIds = Array.from(
      new Set((data || []).map((r: any) => String(r?.[ITEMS_BOX_ID_COL] || "")).filter(Boolean))
    );

    const boxInfo = new Map<string, { box_no: string | null; location: string | null }>();

    if (boxIds.length > 0) {
      const { data: boxes, error: bErr } = await admin
        .from(BOXES_TABLE)
        .select(`${BOXES_ID_COL}, ${BOXES_BOXNO_COL}, ${BOXES_LOCATION_COL}`)
        .in(BOXES_ID_COL, boxIds);

      if (bErr) throw new Error(bErr.message);

      for (const b of boxes || []) {
        boxInfo.set(String((b as any)[BOXES_ID_COL]), {
          box_no: (b as any)[BOXES_BOXNO_COL] ?? null,
          location: (b as any)[BOXES_LOCATION_COL] ?? null,
        });
      }
    }

    for (const row of data || []) {
      const imei = String((row as any)[ITEMS_IMEI_COL] ?? "");
      const box_id = String((row as any)[ITEMS_BOX_ID_COL] ?? "");
      if (!imei || !box_id) continue;

      const info = boxInfo.get(box_id);
      result.set(imei, {
        box_no: info?.box_no ?? null,
        location: info?.location ?? null,
      });
    }
  }

  return result;
}

/* =========================
   Get or create box
   - reuse existing bin if exists (device_id + box_no + location)
========================= */
async function getOrCreateBoxId(params: {
  admin: NonNullable<ReturnType<typeof adminClient>>;
  device_id: string;
  device_display: string;
  box_no: string;
  location: string;
}) {
  const { admin, device_id, device_display, box_no, location } = params;

  // 1) Try find existing
  const { data: existing, error: selErr } = await admin
    .from(BOXES_TABLE)
    .select(`${BOXES_ID_COL}`)
    .eq(BOXES_DEVICE_ID_COL, device_id)
    .eq(BOXES_BOXNO_COL, box_no)
    .eq(BOXES_LOCATION_COL, location)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);

  if (existing?.[BOXES_ID_COL]) return existing[BOXES_ID_COL] as string;

  // 2) Insert new
  const { data: inserted, error: insErr } = await admin
    .from(BOXES_TABLE)
    .insert({
      [BOXES_DEVICE_ID_COL]: device_id,
      [BOXES_DEVICE_COL]: device_display, // keep text for debug
      [BOXES_BOXNO_COL]: box_no,
      [BOXES_LOCATION_COL]: location,
      status: "IN",
    })
    .select(`${BOXES_ID_COL}`)
    .maybeSingle();

  if (insErr) throw new Error(insErr.message);

  const boxId = inserted?.[BOXES_ID_COL];
  if (!boxId) throw new Error("Failed to create box (no box_id returned)");

  return boxId as string;
}

/* =========================
   POST /api/inbound/commit
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const userClient = authedClient(token);
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const userId = userData.user.id;

    /* ---------- FormData ---------- */
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = (form.get("vendor") as Vendor | null) ?? null;
    const location = String(form.get("location") || "").trim() || "00";

    if (!file || !vendor) {
      return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
    }

    // 1) Load devices from DB (for parsing + for device_id mapping)
    const { data: devicesDbRows, error: devErr } = await admin
      .from("devices")
      .select("device_id, canonical_name, device, active");

    if (devErr) throw new Error(devErr.message);

    const devicesDb = toDeviceMatchList(devicesDbRows || []);

    // deviceDisplay -> device_id (case-insensitive + trim)
    const deviceIdByDisplay = new Map<string, string>();
    for (const d of devicesDbRows || []) {
      const display = String((d as any).device ?? "").trim();
      const id = String((d as any).device_id ?? "").trim();
      if (display && id) deviceIdByDisplay.set(display.toLowerCase(), id);
    }

    // 2) Parse excel
    const parsed = parseVendorExcel(vendor, bytes, devicesDb);
    if (!parsed.ok) {
      return NextResponse.json(parsed, { status: 400 });
    }

    // 3) Duplicate check
    const incomingImeis = parsed.labels.flatMap((l) => l.imeis || []);
    const existing = await findExistingImeis(admin, incomingImeis);

    if (existing.size > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Doublons IMEI détectés (${existing.size}). Import bloqué.`,
          duplicates: Array.from(existing.entries()).map(([imei, ex]) => ({
            imei,
            existing_box_no: ex.box_no ?? null,
            existing_location: ex.location ?? null,
          })),
        },
        { status: 400 }
      );
    }

    // 4) Insert / reuse boxes + insert items WITH device_id
    let insertedBoxes = 0;
    let insertedItems = 0;

    for (const l of parsed.labels) {
      const deviceDisplay = String(l.device || "").trim();
      const deviceId = deviceIdByDisplay.get(deviceDisplay.toLowerCase()) || "";

      if (!deviceId) {
        return NextResponse.json(
          { ok: false, error: `Device not found in DB for import: ${deviceDisplay}` },
          { status: 400 }
        );
      }

      const boxId = await getOrCreateBoxId({
        admin,
        device_id: deviceId,
        device_display: deviceDisplay,
        box_no: String(l.box_no || "").trim(),
        location,
      });

      // Count if it was newly created (cheap check)
      // (optional: you can remove this if you don’t care)
      // We’ll just increment when box_no/device/location didn’t exist
      // -> ignore, keep simple

      const rowsToInsert = (l.imeis || []).map((imei) => ({
        [ITEMS_BOX_ID_COL]: boxId,
        [ITEMS_DEVICE_ID_COL]: deviceId,
        [ITEMS_IMEI_COL]: imei,
        status: "IN",
        imported_by: userId,
        imported_at: new Date().toISOString(),
      }));

      // insert in chunks to avoid payload limits
      for (const part of chunk(rowsToInsert, 500)) {
        const { error: itemsErr } = await admin.from(ITEMS_TABLE).insert(part);

        if (itemsErr) {
          if (itemsErr.message.toLowerCase().includes("duplicate")) {
            return NextResponse.json(
              { ok: false, error: "IMEI déjà existant détecté pendant insertion." },
              { status: 400 }
            );
          }
          throw new Error(itemsErr.message);
        }

        insertedItems += part.length;
      }

      // Update box qty/status quickly (optional but nice)
      await admin
        .from(BOXES_TABLE)
        .update({ status: "IN" })
        .eq(BOXES_ID_COL, boxId);

      insertedBoxes += 1;
    }

    return NextResponse.json({
      ok: true,
      counts: parsed.counts,
      inserted_boxes: insertedBoxes,
      inserted_items: insertedItems,
    });
  } catch (e: any) {
    console.error("Inbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}