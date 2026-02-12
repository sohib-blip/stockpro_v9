// app/api/dashboard/export-in/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/* =========================
   ✅ CONFIG DB
========================= */
const DEVICES_TABLE = "devices";
const DEVICES_ID_COL = "device_id";
const DEVICES_NAME_COL = "device";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_BOXNO_COL = "box_no";
const BOXES_LOCATION_COL = "location";

const ITEMS_TABLE = "items";
const ITEMS_IMEI_COL = "imei";
const ITEMS_DEVICE_ID_COL = "device_id";
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_STATUS_COL = "status";

const STATUS_IN = "IN";

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

export async function GET(req: Request) {
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

    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
    }

    /* ---------- Params ---------- */
    const url = new URL(req.url);
    const deviceFilter = String(url.searchParams.get("device") || "").trim(); // display name (or partial)
    const locationFilter = String(url.searchParams.get("location") || "").trim(); // exact (ex "02")

    /* ---------- Resolve deviceFilter -> device_id (optional) ---------- */
    let deviceIdFilter: string | null = null;

    if (deviceFilter) {
      // more robust than eq: match exact first, else ilike
      const { data: devExact, error: devExactErr } = await admin
        .from(DEVICES_TABLE)
        .select(`${DEVICES_ID_COL}, ${DEVICES_NAME_COL}`)
        .eq(DEVICES_NAME_COL, deviceFilter)
        .maybeSingle();

      if (devExactErr) {
        return NextResponse.json({ ok: false, error: devExactErr.message }, { status: 500 });
      }

      if (devExact?.[DEVICES_ID_COL]) {
        deviceIdFilter = String((devExact as any)[DEVICES_ID_COL]);
      } else {
        const { data: devLike, error: devLikeErr } = await admin
          .from(DEVICES_TABLE)
          .select(`${DEVICES_ID_COL}, ${DEVICES_NAME_COL}`)
          .ilike(DEVICES_NAME_COL, `%${deviceFilter}%`)
          .order(DEVICES_NAME_COL, { ascending: true })
          .limit(1)
          .maybeSingle();

        if (devLikeErr) {
          return NextResponse.json({ ok: false, error: devLikeErr.message }, { status: 500 });
        }

        deviceIdFilter = devLike ? String((devLike as any)[DEVICES_ID_COL] ?? "") : null;
      }

      if (!deviceIdFilter) {
        return NextResponse.json({ ok: false, error: `Device not found: ${deviceFilter}` }, { status: 400 });
      }
    }

    /* ---------- 1) Fetch items IN (paged) ---------- */
    const pageSize = 5000;
    let from = 0;

    const itemsAll: Array<{ imei: string; box_id: string | null; device_id: string | null }> = [];

    while (true) {
      let q = admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_IMEI_COL}, ${ITEMS_BOX_ID_COL}, ${ITEMS_DEVICE_ID_COL}`)
        .eq(ITEMS_STATUS_COL, STATUS_IN)
        .range(from, from + pageSize - 1);

      if (deviceIdFilter) q = q.eq(ITEMS_DEVICE_ID_COL, deviceIdFilter);

      const { data, error } = await q;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      const batch = (data || [])
        .map((r: any) => ({
          imei: String(r?.[ITEMS_IMEI_COL] ?? "").trim(),
          box_id: (r?.[ITEMS_BOX_ID_COL] ?? null) as string | null,
          device_id: (r?.[ITEMS_DEVICE_ID_COL] ?? null) as string | null,
        }))
        .filter((x) => x.imei);

      itemsAll.push(...batch);

      if (!data || data.length < pageSize) break;
      from += pageSize;
    }

    /* ---------- 2) Fetch devices + boxes maps ---------- */
    const deviceIds = Array.from(new Set(itemsAll.map((x) => x.device_id).filter(Boolean))) as string[];
    const boxIds = Array.from(new Set(itemsAll.map((x) => x.box_id).filter(Boolean))) as string[];

    const devicesMap = new Map<string, string>(); // device_id -> name
    for (const part of chunk(deviceIds, 500)) {
      const { data, error } = await admin
        .from(DEVICES_TABLE)
        .select(`${DEVICES_ID_COL}, ${DEVICES_NAME_COL}`)
        .in(DEVICES_ID_COL, part);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      for (const d of data || []) {
        const id = String((d as any)[DEVICES_ID_COL] ?? "");
        const name = String((d as any)[DEVICES_NAME_COL] ?? "");
        if (id) devicesMap.set(id, name);
      }
    }

    const boxesMap = new Map<string, { box_no: string; location: string }>();
    for (const part of chunk(boxIds, 500)) {
      const { data, error } = await admin
        .from(BOXES_TABLE)
        .select(`${BOXES_ID_COL}, ${BOXES_BOXNO_COL}, ${BOXES_LOCATION_COL}`)
        .in(BOXES_ID_COL, part);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      for (const b of data || []) {
        const id = String((b as any)[BOXES_ID_COL] ?? "");
        const box_no = String((b as any)[BOXES_BOXNO_COL] ?? "");
        const location = String((b as any)[BOXES_LOCATION_COL] ?? "");
        if (id) boxesMap.set(id, { box_no, location });
      }
    }

    /* ---------- 3) Build export rows (apply location filter here) ---------- */
    let exportRows = itemsAll.map((it) => {
      const device_name = it.device_id ? (devicesMap.get(it.device_id) || "") : "";
      const b = it.box_id ? boxesMap.get(it.box_id) : null;

      return {
        device: device_name,
        imei: it.imei,
        box_id: it.box_id ?? "",
        box_no: b?.box_no ?? "",
        etage: b?.location ?? "",
      };
    });

    if (locationFilter) {
      exportRows = exportRows.filter((r) => String(r.etage || "") === locationFilter);
    }

    /* ---------- 4) Generate XLSX ---------- */
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "IN_STOCK");

    const fileData = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const uint8 = new Uint8Array(fileData as ArrayBuffer);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    const safeDev = deviceFilter ? deviceFilter.replace(/[^\w\-]+/g, "_") : "";
    const safeLoc = locationFilter ? locationFilter.replace(/[^\w\-]+/g, "_") : "";

    const filenameParts = ["in_stock"];
    if (safeDev) filenameParts.push(safeDev);
    if (safeLoc) filenameParts.push(`loc_${safeLoc}`);
    filenameParts.push(`${yyyy}-${mm}-${dd}`);

    const filename = `${filenameParts.join("_")}.xlsx`;

    return new NextResponse(uint8, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    console.error("Export IN error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}