// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* =========================
   ✅ CONFIG DB
========================= */
const DEVICES_TABLE = "devices";
const DEVICES_ID_COL = "device_id";
const DEVICES_NAME_COL = "device"; // display name
const DEVICES_ACTIVE_COL = "active";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_LOCATION_COL = "location";

const ITEMS_TABLE = "items";
const ITEMS_DEVICE_ID_COL = "device_id";
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_STATUS_COL = "status";

// tes statuts dans items.status (vu dans ton screenshot)
const STATUS_IN = "IN";
const STATUS_OUT = "OUT";

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

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* =========================
   GET /api/dashboard
   Query params:
   - q: filter device name (ilike)
   - page: 1..n
   - limit: default 25 (max 100)
========================= */
export async function GET(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing Bearer token" },
        { status: 401 }
      );
    }

    const userClient = authedClient(token);
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = adminClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Server misconfiguration" },
        { status: 500 }
      );
    }

    /* ---------- Params ---------- */
    const url = new URL(req.url);
    const q = String(url.searchParams.get("q") || "").trim();
    const page = Math.max(1, toInt(url.searchParams.get("page"), 1));
    const limitRaw = toInt(url.searchParams.get("limit"), 25);
    const limit = Math.min(100, Math.max(1, limitRaw));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    /* =========================
       1) Global stats (fast)
    ========================= */
    const [
      devicesCountRes,
      inCountRes,
      outCountRes,
      itemsCountRes,
    ] = await Promise.all([
      admin.from(DEVICES_TABLE).select(DEVICES_ID_COL, { count: "exact", head: true }),
      admin.from(ITEMS_TABLE).select("item_id", { count: "exact", head: true }).eq(ITEMS_STATUS_COL, STATUS_IN),
      admin.from(ITEMS_TABLE).select("item_id", { count: "exact", head: true }).eq(ITEMS_STATUS_COL, STATUS_OUT),
      admin.from(ITEMS_TABLE).select("item_id", { count: "exact", head: true }),
    ]);

    const totalDevices = devicesCountRes.count ?? 0;
    const inStock = inCountRes.count ?? 0;
    const outStock = outCountRes.count ?? 0;
    const totalItems = itemsCountRes.count ?? 0;

    /* =========================
       2) Devices list (paginated + filter)
    ========================= */
    let devQuery = admin
      .from(DEVICES_TABLE)
      .select(`${DEVICES_ID_COL}, ${DEVICES_NAME_COL}, ${DEVICES_ACTIVE_COL}`, { count: "exact" })
      .order(DEVICES_NAME_COL, { ascending: true })
      .range(from, to);

    if (q) {
      // filter by display name
      devQuery = devQuery.ilike(DEVICES_NAME_COL, `%${q}%`);
    }

    const { data: devices, count: devicesFilteredCount, error: devErr } = await devQuery;

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    const deviceIds = (devices || [])
      .map((d: any) => d?.[DEVICES_ID_COL])
      .filter(Boolean);

    /* =========================
       3) Compute IN/OUT per device (only for visible page)
       (simple + safe, on optimise après si besoin)
    ========================= */
    const countsByDevice: Record<string, { in: number; out: number; total: number }> = {};
    for (const id of deviceIds) {
      countsByDevice[String(id)] = { in: 0, out: 0, total: 0 };
    }

    if (deviceIds.length > 0) {
      // fetch items for these devices (only status + device_id)
      const { data: itemsRows, error: itemsErr } = await admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_DEVICE_ID_COL}, ${ITEMS_STATUS_COL}`)
        .in(ITEMS_DEVICE_ID_COL, deviceIds);

      if (itemsErr) {
        return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
      }

      for (const row of itemsRows || []) {
        const did = String((row as any)[ITEMS_DEVICE_ID_COL] ?? "");
        const st = String((row as any)[ITEMS_STATUS_COL] ?? "");
        if (!did || !countsByDevice[did]) continue;

        if (st === STATUS_IN) countsByDevice[did].in += 1;
        if (st === STATUS_OUT) countsByDevice[did].out += 1;
        countsByDevice[did].total += 1;
      }
    }

    const deviceRows = (devices || []).map((d: any) => {
      const id = String(d?.[DEVICES_ID_COL] ?? "");
      const name = String(d?.[DEVICES_NAME_COL] ?? "");
      const active = d?.[DEVICES_ACTIVE_COL] !== false;

      const c = countsByDevice[id] || { in: 0, out: 0, total: 0 };

      return {
        device_id: id,
        device: name,
        active,
        in: c.in,
        out: c.out,
        total: c.total,
      };
    });

    /* =========================
       4) In stock by location
       (version simple: on lit boxes + items IN et on agrège côté API)
    ========================= */
    const { data: boxes, error: boxErr } = await admin
      .from(BOXES_TABLE)
      .select(`${BOXES_ID_COL}, ${BOXES_LOCATION_COL}`);

    if (boxErr) {
      return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    }

    const boxLocById = new Map<string, string>();
    for (const b of boxes || []) {
      const id = String((b as any)[BOXES_ID_COL] ?? "");
      const loc = String((b as any)[BOXES_LOCATION_COL] ?? "UNKNOWN") || "UNKNOWN";
      if (id) boxLocById.set(id, loc);
    }

    const { data: inItems, error: inItemsErr } = await admin
      .from(ITEMS_TABLE)
      .select(`${ITEMS_BOX_ID_COL}, ${ITEMS_STATUS_COL}`)
      .eq(ITEMS_STATUS_COL, STATUS_IN);

    if (inItemsErr) {
      return NextResponse.json({ ok: false, error: inItemsErr.message }, { status: 500 });
    }

    const inByLocation: Record<string, number> = {};
    for (const it of inItems || []) {
      const boxId = String((it as any)[ITEMS_BOX_ID_COL] ?? "");
      const loc = boxLocById.get(boxId) || "UNKNOWN";
      inByLocation[loc] = (inByLocation[loc] || 0) + 1;
    }

    const inStockByLocation = Object.entries(inByLocation)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([location, count]) => ({ location, in: count }));

    /* ---------- Response ---------- */
    return NextResponse.json({
      ok: true,
      stats: {
        devices: totalDevices,
        in_stock: inStock,
        out_stock: outStock,
        total_items: totalItems,
      },
      in_stock_by_location: inStockByLocation,
      devices: deviceRows,
      pagination: {
        q,
        page,
        limit,
        total_filtered: devicesFilteredCount ?? 0,
      },
    });
  } catch (e: any) {
    console.error("Dashboard error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}