// app/api/inbound/manual/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* =========================
   ✅ CONFIG DB (adapte si besoin)
========================= */
const DEVICES_TABLE = "devices";
const DEVICES_NAME_COL = "device";
const DEVICES_ACTIVE_COL = "active";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_DEVICE_COL = "device";
const BOXES_BOXNO_COL = "box_no";
const BOXES_LOCATION_COL = "location";
const BOXES_STATUS_COL = "status";

const ITEMS_TABLE = "items";
const ITEMS_IMEI_COL = "imei";
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_STATUS_COL = "status";

const STATUS_IN = "IN";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function normalizeImei(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function isImei(v: any) {
  const s = normalizeImei(v);
  return /^\d{14,17}$/.test(s);
}

function uniq(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function findExistingImeis(
  admin: NonNullable<ReturnType<typeof adminClient>>,
  imeis: string[]
): Promise<Map<string, { box_id: string | null; box_no: string | null; device: string | null; location: string | null; status: string | null }>> {
  const map = new Map<string, { box_id: string | null; box_no: string | null; device: string | null; location: string | null; status: string | null }>();
  const clean = uniq(imeis.map(normalizeImei).filter((x) => /^\d{14,17}$/.test(x)));
  if (clean.length === 0) return map;

  // 1) items where imei in list
  const itemsRows: Array<{ imei: string; box_id: string | null; status: string | null }> = [];

  for (const part of chunk(clean, 500)) {
    const { data, error } = await admin
      .from(ITEMS_TABLE)
      .select(`${ITEMS_IMEI_COL}, ${ITEMS_BOX_ID_COL}, ${ITEMS_STATUS_COL}`)
      .in(ITEMS_IMEI_COL, part);

    if (error) throw new Error(`Duplicate check failed (items): ${error.message}`);

    for (const r of data || []) {
      const imei = String((r as any)[ITEMS_IMEI_COL] ?? "").trim();
      const box_id = ((r as any)[ITEMS_BOX_ID_COL] ?? null) as string | null;
      const status = String((r as any)[ITEMS_STATUS_COL] ?? "").trim() || null;
      if (imei) itemsRows.push({ imei, box_id, status });
    }
  }

  if (itemsRows.length === 0) return map;

  // 2) boxes info
  const boxIds = uniq(itemsRows.map((x) => String(x.box_id || "")).filter(Boolean));
  const boxesById = new Map<string, any>();

  if (boxIds.length > 0) {
    const { data: boxes, error } = await admin
      .from(BOXES_TABLE)
      .select(`${BOXES_ID_COL}, ${BOXES_BOXNO_COL}, ${BOXES_DEVICE_COL}, ${BOXES_LOCATION_COL}`)
      .in(BOXES_ID_COL, boxIds);

    if (error) throw new Error(`Duplicate check failed (boxes): ${error.message}`);

    for (const b of boxes || []) {
      const id = String((b as any)[BOXES_ID_COL] ?? "");
      if (id) boxesById.set(id, b);
    }
  }

  for (const it of itemsRows) {
    const b = it.box_id ? boxesById.get(String(it.box_id)) : null;
    map.set(normalizeImei(it.imei), {
      box_id: it.box_id ?? null,
      box_no: b ? String((b as any)[BOXES_BOXNO_COL] ?? "") || null : null,
      device: b ? String((b as any)[BOXES_DEVICE_COL] ?? "") || null : null,
      location: b ? String((b as any)[BOXES_LOCATION_COL] ?? "") || null : null,
      status: it.status ?? null,
    });
  }

  return map;
}

async function createOrFetchBox(admin: NonNullable<ReturnType<typeof adminClient>>, payload: { device: string; box_no: string; location: string }) {
  // try insert
  const { data: inserted, error: insErr } = await admin
    .from(BOXES_TABLE)
    .insert({
      [BOXES_DEVICE_COL]: payload.device,
      [BOXES_BOXNO_COL]: payload.box_no,
      [BOXES_LOCATION_COL]: payload.location,
      [BOXES_STATUS_COL]: STATUS_IN,
    })
    .select(`${BOXES_ID_COL}`)
    .maybeSingle();

  if (!insErr && inserted?.[BOXES_ID_COL]) return String(inserted[BOXES_ID_COL]);

  // fallback: fetch existing by device+box_no
  const { data: existing, error: fetchErr } = await admin
    .from(BOXES_TABLE)
    .select(`${BOXES_ID_COL}`)
    .eq(BOXES_DEVICE_COL, payload.device)
    .eq(BOXES_BOXNO_COL, payload.box_no)
    .maybeSingle();

  if (fetchErr || !existing?.[BOXES_ID_COL]) {
    const msg = insErr?.message || fetchErr?.message || "Unknown error";
    throw new Error(`Failed create/fetch box (${payload.device} ${payload.box_no}): ${msg}`);
  }

  return String(existing[BOXES_ID_COL]);
}

/* =========================
   POST /api/inbound/manual
   Body JSON:
   {
     mode: "preview" | "commit",
     device: string,
     box_no: string,
     location: string,
     imeis: string[]
   }
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });

    /* ---------- Body ---------- */
    const body = await req.json().catch(() => ({}));

    const mode = String((body as any).mode || "preview");
    const device = String((body as any).device || "").trim();
    const box_no = String((body as any).box_no || "").trim();
    const location = String((body as any).location || "").trim() || "00";
    const imeisRaw: any[] = Array.isArray((body as any).imeis) ? (body as any).imeis : [];

    if (!device || !box_no) {
      return NextResponse.json({ ok: false, error: "Missing device or box_no" }, { status: 400 });
    }

    // validate device exists (active)
    const { data: devRow, error: devErr } = await admin
      .from(DEVICES_TABLE)
      .select(`${DEVICES_NAME_COL}, ${DEVICES_ACTIVE_COL}`)
      .eq(DEVICES_NAME_COL, device)
      .maybeSingle();

    if (devErr) return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    if (!devRow || devRow?.[DEVICES_ACTIVE_COL] === false) {
      return NextResponse.json({ ok: false, error: `Device not found/active: ${device}` }, { status: 400 });
    }

    // parse imeis
    const normalized = imeisRaw.map(normalizeImei).filter(Boolean);
    const valid = normalized.filter((x) => /^\d{14,17}$/.test(x));
    const invalid = uniq(normalized.filter((x) => x && !/^\d{14,17}$/.test(x)));

    // duplicates inside incoming list
    const seen = new Set<string>();
    const dupInFile: string[] = [];
    for (const i of valid) {
      if (seen.has(i)) dupInFile.push(i);
      seen.add(i);
    }

    const imeis = uniq(valid);

    if (imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid IMEIs", invalid_sample: invalid.slice(0, 10) },
        { status: 400 }
      );
    }

    /* ---------- Duplicate check in DB (block) ---------- */
    const existing = await findExistingImeis(admin, imeis);

    if (existing.size > 0) {
      const duplicates = imeis
        .filter((i) => existing.has(i))
        .map((i) => {
          const ex = existing.get(i)!;
          return {
            imei: i,
            incoming_device: device,
            incoming_box_no: box_no,
            incoming_location: location,
            existing_device: ex.device,
            existing_box_no: ex.box_no,
            existing_location: ex.location,
            existing_status: ex.status,
          };
        });

      return NextResponse.json(
        {
          ok: false,
          error: `Doublons IMEI détectés (${existing.size}). Import bloqué.`,
          duplicates_count: existing.size,
          duplicates,
          incoming: { device, box_no, location },
          counts: {
            imeis_total: imeis.length,
            invalid: invalid.length,
            dup_in_file: uniq(dupInFile).length,
          },
        },
        { status: 400 }
      );
    }

    /* ---------- Preview response ---------- */
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        incoming: { device, box_no, location },
        counts: {
          imeis_total: imeis.length,
          invalid: invalid.length,
          dup_in_file: uniq(dupInFile).length,
        },
        invalid_sample: invalid.slice(0, 20),
        dup_in_file_sample: uniq(dupInFile).slice(0, 20),
        imeis,
      });
    }

    /* ---------- Commit ---------- */
    if (mode !== "commit") {
      return NextResponse.json({ ok: false, error: "Invalid mode (use preview or commit)" }, { status: 400 });
    }

    // create or fetch box
    const boxId = await createOrFetchBox(admin, { device, box_no, location });

    // insert items
    const rowsToInsert = imeis.map((imei) => ({
      [ITEMS_BOX_ID_COL]: boxId,
      [ITEMS_IMEI_COL]: imei,
      [ITEMS_STATUS_COL]: STATUS_IN,
    }));

    // chunk insert (avoid payload limits)
    for (const part of chunk(rowsToInsert, 500)) {
      const { error: insErr } = await admin.from(ITEMS_TABLE).insert(part);
      if (insErr) {
        return NextResponse.json(
          { ok: false, error: `Insert items failed: ${insErr.message}`, box_id: boxId },
          { status: 500 }
        );
      }
    }

    // ensure box status IN
    await admin.from(BOXES_TABLE).update({ [BOXES_STATUS_COL]: STATUS_IN }).eq(BOXES_ID_COL, boxId);

    return NextResponse.json({
      ok: true,
      mode: "commit",
      incoming: { device, box_no, location },
      box_id: boxId,
      inserted: imeis.length,
    });
  } catch (e: any) {
    console.error("Manual inbound error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
