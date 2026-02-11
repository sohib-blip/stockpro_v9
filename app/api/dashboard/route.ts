// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* =========================
   ✅ CONFIG DB
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
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_STATUS_COL = "status";

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

/* =========================
   GET /api/dashboard
   Query params:
   - device: exact match device name
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
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
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
    const deviceFilter = String(url.searchParams.get("device") || "").trim();

    /* =========================
       1) Load devices (dropdown)
    ========================= */
    const { data: devicesRows, error: devErr } = await admin
      .from(DEVICES_TABLE)
      .select(`${DEVICES_NAME_COL}, ${DEVICES_ACTIVE_COL}`)
      .order(DEVICES_NAME_COL, { ascending: true });

    if (devErr) {
      return NextResponse.json(
        { ok: false, error: devErr.message },
        { status: 500 }
      );
    }

    const devices = (devicesRows || [])
      .filter((d: any) => d?.[DEVICES_ACTIVE_COL] !== false)
      .map((d: any) => String(d?.[DEVICES_NAME_COL] ?? "").trim())
      .filter(Boolean);

    /* =========================
       2) Load boxes
       (we need box_id -> device)
    ========================= */
    let boxesQuery = admin
      .from(BOXES_TABLE)
      .select(`${BOXES_ID_COL}, ${BOXES_DEVICE_COL}`);

    if (deviceFilter) {
      boxesQuery = boxesQuery.eq(BOXES_DEVICE_COL, deviceFilter);
    }

    const { data: boxesRows, error: boxErr } = await boxesQuery;
    if (boxErr) {
      return NextResponse.json(
        { ok: false, error: boxErr.message },
        { status: 500 }
      );
    }

    const boxDeviceById = new Map<string, string>();
    const boxIds: string[] = [];

    for (const b of boxesRows || []) {
      const id = String((b as any)[BOXES_ID_COL] ?? "").trim();
      const dev = String((b as any)[BOXES_DEVICE_COL] ?? "").trim();
      if (id) {
        boxIds.push(id);
        boxDeviceById.set(id, dev);
      }
    }

    /* =========================
       3) Load items (IN + OUT)
       and aggregate by device via box_id
    ========================= */
    // If there are no boxes, we can return empty stock cleanly.
    let itemsRows: any[] = [];
    if (boxIds.length > 0) {
      // If your DB is huge, we can optimize later.
      const { data, error } = await admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_BOX_ID_COL}, ${ITEMS_STATUS_COL}`)
        .in(ITEMS_BOX_ID_COL, boxIds);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }
      itemsRows = data || [];
    }

    const itemsTotal = itemsRows.length;

    const boxesSetByDevice = new Map<string, Set<string>>();
    const itemsCountByDevice = new Map<string, number>();

    let inTotal = 0;
    let outTotal = 0;

    for (const row of itemsRows) {
      const boxId = String((row as any)[ITEMS_BOX_ID_COL] ?? "").trim();
      const st = String((row as any)[ITEMS_STATUS_COL] ?? "").trim().toUpperCase();
      const dev = boxDeviceById.get(boxId) || "";

      if (!dev) continue;

      if (!boxesSetByDevice.has(dev)) boxesSetByDevice.set(dev, new Set<string>());
      boxesSetByDevice.get(dev)!.add(boxId);

      itemsCountByDevice.set(dev, (itemsCountByDevice.get(dev) || 0) + 1);

      if (st === STATUS_IN) inTotal += 1;
      else if (st === STATUS_OUT) outTotal += 1;
    }

    const boxesTotal = boxIds.length;

    /* =========================
       4) Build stock rows
       (StockRow = { device, boxes, items })
    ========================= */
    const stockAll = uniq(
      deviceFilter ? [deviceFilter] : devices
    ).map((dev) => {
      const boxesCount = boxesSetByDevice.get(dev)?.size || 0;
      const itemsCount = itemsCountByDevice.get(dev) || 0;
      return { device: dev, boxes: boxesCount, items: itemsCount };
    });

    // Sort like a dashboard: most items first
    stockAll.sort((a, b) => (b.items - a.items) || a.device.localeCompare(b.device));

    /* =========================
       5) imports + movements
       (optional tables — return empty if not present)
    ========================= */
    // Your UI can handle empty arrays.
    const imports: any[] = [];
    const movements: any[] = [];

    /* ---------- Response ---------- */
    return NextResponse.json({
      ok: true,
      devices, // string[]
      kpi: {
        devices: devices.length,
        boxes: boxesTotal,
        items: itemsTotal,
      },
      stock: stockAll,
      imports,
      movements,
    });
  } catch (e: any) {
    console.error("Dashboard error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}