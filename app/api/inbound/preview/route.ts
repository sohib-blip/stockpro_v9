import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

/* =========================
   ✅ CONFIG (selon ton DB)
========================= */
const ITEMS_TABLE = "items";
const ITEMS_IMEI_COL = "imei";
const ITEMS_BOX_ID_COL = "box_id";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_BOXNO_COL = "box_no";
const BOXES_LOCATION_COL = "location"; // si tu n’as pas cette colonne -> mets ""

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

/**
 * Doublons DANS le fichier (même import)
 * -> map imei -> { device, box_no }
 */
function findDuplicateImeisInFile(labels: Array<{ device: string; box_no: string; imeis?: string[] }>) {
  const seen = new Map<string, { device: string; box_no: string }>();
  const dups = new Map<string, Array<{ device: string; box_no: string }>>();

  for (const l of labels) {
    for (const raw of l.imeis || []) {
      const imei = String(raw || "").trim();
      if (!imei) continue;

      if (!seen.has(imei)) {
        seen.set(imei, { device: l.device, box_no: l.box_no });
        continue;
      }

      const first = seen.get(imei)!;
      if (!dups.has(imei)) dups.set(imei, [first]);
      dups.get(imei)!.push({ device: l.device, box_no: l.box_no });
    }
  }

  return dups; // imei -> [{device, box_no}, ...]
}

/**
 * Check duplicates in DB:
 * retourne map imei -> { box_id, box_no, location? }
 */
async function findExistingImeis(
  admin: NonNullable<ReturnType<typeof adminClient>>,
  imeis: string[]
): Promise<Map<string, { box_id: string | null; box_no?: string | null; location?: string | null }>> {
  const result = new Map<string, { box_id: string | null; box_no?: string | null; location?: string | null }>();
  if (imeis.length === 0) return result;

  const uniqueImeis = Array.from(new Set(imeis.map((x) => String(x || "").trim()).filter(Boolean)));
  if (uniqueImeis.length === 0) return result;

  // 1) items rows (imei -> box_id)
  const imeiChunks = chunk(uniqueImeis, 500);
  const itemsRows: Array<{ imei: string; box_id: string | null }> = [];

  for (const part of imeiChunks) {
    const { data, error } = await admin
      .from(ITEMS_TABLE)
      .select(`${ITEMS_IMEI_COL}, ${ITEMS_BOX_ID_COL}`)
      .in(ITEMS_IMEI_COL, part);

    if (error) throw new Error(`Duplicate check failed (items): ${error.message}`);

    for (const row of data || []) {
      const imei = String((row as any)[ITEMS_IMEI_COL] ?? "").trim();
      const box_id = ((row as any)[ITEMS_BOX_ID_COL] ?? null) as string | null;
      if (imei) itemsRows.push({ imei, box_id });
    }
  }

  if (itemsRows.length === 0) return result;

  // 2) fetch boxes details for these box_ids
  const boxIds = Array.from(new Set(itemsRows.map((x) => x.box_id).filter(Boolean))) as string[];

  const boxesById = new Map<string, any>();
  if (boxIds.length > 0) {
    const selectCols = [BOXES_ID_COL, BOXES_BOXNO_COL].concat(
      BOXES_LOCATION_COL ? [BOXES_LOCATION_COL] : []
    );

    const { data: boxes, error: bErr } = await admin
      .from(BOXES_TABLE)
      .select(selectCols.join(","))
      .in(BOXES_ID_COL, boxIds);

    if (bErr) throw new Error(`Duplicate check failed (boxes): ${bErr.message}`);

    for (const b of boxes || []) {
      const id = String((b as any)[BOXES_ID_COL] ?? "");
      if (id) boxesById.set(id, b);
    }
  }

  for (const it of itemsRows) {
    const b = it.box_id ? boxesById.get(it.box_id) : null;
    result.set(it.imei, {
      box_id: it.box_id,
      box_no: b ? String((b as any)[BOXES_BOXNO_COL] ?? "") : null,
      location: b && BOXES_LOCATION_COL ? String((b as any)[BOXES_LOCATION_COL] ?? "") : null,
    });
  }

  return result;
}

/* =========================
   POST /api/inbound/preview
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
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    /* ---------- FormData ---------- */
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = (form.get("vendor") as Vendor | null) ?? null;
    const location = String(form.get("location") || "").trim() || "00";

    if (!file || !vendor) {
      return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });
    }

    /* ---------- Read Excel (bytes) ---------- */
    const bytes = new Uint8Array(await file.arrayBuffer());

    /* ---------- Admin + devices list ---------- */
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
    }

    const { data: devicesDbRows, error: devErr } = await admin
      .from("devices")
      .select("canonical_name, device, active");

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    const devicesDb = toDeviceMatchList(devicesDbRows || []);

    /* ---------- Parse ---------- */
    const parsed = parseVendorExcel(vendor, bytes, devicesDb);
    if (!parsed.ok) {
      return NextResponse.json(parsed, { status: 400 });
    }

    /* ---------- Duplicate check: FILE ---------- */
    const fileDups = findDuplicateImeisInFile(parsed.labels);
    if (fileDups.size > 0) {
      const duplicates = Array.from(fileDups.entries()).map(([imei, occurrences]) => ({
        imei,
        type: "FILE_DUPLICATE" as const,
        occurrences, // [{device, box_no}, ...]
      }));

      return NextResponse.json(
        {
          ok: false,
          error: `Doublons IMEI dans le fichier (${fileDups.size}). Import bloqué.`,
          duplicates_count: fileDups.size,
          duplicates,
          counts: parsed.counts,
          debug: parsed.debug ?? null,
        },
        { status: 400 }
      );
    }

    /* ---------- Duplicate check: DB ---------- */
    const incomingImeis = parsed.labels.flatMap((l) => l.imeis || []);
    const existing = await findExistingImeis(admin, incomingImeis);

    if (existing.size > 0) {
      const dupRows: Array<{
        imei: string;
        incoming_device: string;
        incoming_box_no: string;
        existing_box_no: string | null;
        existing_location: string | null;
      }> = [];

      for (const l of parsed.labels) {
        for (const imei of l.imeis || []) {
          const ex = existing.get(imei);
          if (!ex) continue;

          dupRows.push({
            imei,
            incoming_device: l.device,
            incoming_box_no: l.box_no,
            existing_box_no: ex.box_no ?? null,
            existing_location: ex.location ?? null,
          });
        }
      }

      return NextResponse.json(
        {
          ok: false,
          error: `Doublons IMEI déjà en stock (${existing.size}). Import bloqué.`,
          duplicates_count: existing.size,
          duplicates: dupRows,
          counts: parsed.counts,
          debug: parsed.debug ?? null,
        },
        { status: 400 }
      );
    }

    /* ---------- Return OK ---------- */
    return NextResponse.json({
      ok: true,
      vendor,
      location,
      counts: parsed.counts,
      labels: parsed.labels.map((l) => ({
        device: l.device,
        box_no: l.box_no,
        qty: l.qty,
        qr_data: l.qr_data,
      })),
      debug: parsed.debug ?? null,
    });
  } catch (e: any) {
    console.error("Inbound preview error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}