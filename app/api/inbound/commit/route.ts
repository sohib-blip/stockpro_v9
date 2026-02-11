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

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_BOXNO_COL = "box_no";
const BOXES_LOCATION_COL = "location";

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
   Duplicate check
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

    for (const row of data || []) {
      const imei = row[ITEMS_IMEI_COL];
      const box_id = row[ITEMS_BOX_ID_COL];

      if (!box_id) continue;

      const { data: box } = await admin
        .from(BOXES_TABLE)
        .select(`${BOXES_BOXNO_COL}, ${BOXES_LOCATION_COL}`)
        .eq(BOXES_ID_COL, box_id)
        .maybeSingle();

      result.set(imei, {
        box_no: box?.[BOXES_BOXNO_COL] ?? null,
        location: box?.[BOXES_LOCATION_COL] ?? null,
      });
    }
  }

  return result;
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

    const bytes = new Uint8Array(await file.arrayBuffer());

    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
    }

    const { data: devicesDbRows } = await admin
      .from("devices")
      .select("canonical_name, device, active");

    const devicesDb = toDeviceMatchList(devicesDbRows || []);

    const parsed = parseVendorExcel(vendor, bytes, devicesDb);
    if (!parsed.ok) {
      return NextResponse.json(parsed, { status: 400 });
    }

    /* ---------- Duplicate check AGAIN ---------- */
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

    /* ---------- Insert ---------- */
    for (const l of parsed.labels) {
      const { data: boxRow, error: boxErr } = await admin
        .from(BOXES_TABLE)
        .insert({
          box_no: l.box_no,
          location,
        })
        .select(BOXES_ID_COL)
        .maybeSingle();

      if (boxErr) throw new Error(boxErr.message);

      const boxId = boxRow?.[BOXES_ID_COL];

      const rowsToInsert = l.imeis.map((imei) => ({
        box_id: boxId,
        imei,
        status: "IN",
      }));

      const { error: itemsErr } = await admin.from(ITEMS_TABLE).insert(rowsToInsert);

      if (itemsErr) {
        // sécurité ultime si unique constraint déclenche
        if (itemsErr.message.includes("duplicate")) {
          return NextResponse.json(
            { ok: false, error: "IMEI déjà existant détecté pendant insertion." },
            { status: 400 }
          );
        }
        throw new Error(itemsErr.message);
      }
    }

    return NextResponse.json({
      ok: true,
      counts: parsed.counts,
    });
  } catch (e: any) {
    console.error("Inbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}