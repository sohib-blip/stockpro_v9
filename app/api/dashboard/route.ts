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

const ITEMS_TABLE = "items";
const ITEMS_BOX_ID_COL = "box_id";
const ITEMS_STATUS_COL = "status";

// status values
const STATUS_IN = "IN";
const STATUS_OUT = "OUT";

/* =========================
   Optional tables (if they exist)
========================= */
const IMPORT_HISTORY_TABLE = "import_history"; // if exists
const MOVEMENT_HISTORY_TABLE = "movement_history"; // if exists

/* =========================
   Supabase helpers
========================= */
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

function safeStr(v: any) {
  return String(v ?? "").trim();
}

/* =========================
   GET /api/dashboard
   Query:
   - device: filter device name (exact match on boxes.device)
========================= */
export async function GET(req: Request) {
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

    /* ---------- Params ---------- */
    const url = new URL(req.url);
    const deviceFilter = safeStr(url.searchParams.get("device"));

    /* =========================
       1) Devices dropdown
       (from devices table)
    ========================= */
    const { data: devRows, error: devErr } = await admin
      .from(DEVICES_TABLE)
      .select(`${DEVICES_NAME_COL}, ${DEVICES_ACTIVE_COL}`)
      .order(DEVICES_NAME_COL, { ascending: true });

    if (devErr) return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });

    const devices = (devRows || [])
      .filter((d: any) => d?.[DEVICES_ACTIVE_COL] !== false)
      .map((d: any) => safeStr(d?.[DEVICES_NAME_COL]))
      .filter(Boolean);

    /* =========================
       2) Boxes list (for stock calc)
    ========================= */
    let boxesQuery = admin
      .from(BOXES_TABLE)
      .select(`${BOXES_ID_COL}, ${BOXES_DEVICE_COL}, ${BOXES_BOXNO_COL}, ${BOXES_LOCATION_COL}`);

    if (deviceFilter) {
      boxesQuery = boxesQuery.eq(BOXES_DEVICE_COL, deviceFilter);
    }

    const { data: boxes, error: boxesErr } = await boxesQuery;
    if (boxesErr) return NextResponse.json({ ok: false, error: boxesErr.message }, { status: 500 });

    const boxesList = (boxes || []).map((b: any) => ({
      box_id: safeStr(b?.[BOXES_ID_COL]),
      device: safeStr(b?.[BOXES_DEVICE_COL]),
      box_no: safeStr(b?.[BOXES_BOXNO_COL]),
      location: safeStr(b?.[BOXES_LOCATION_COL]) || "UNKNOWN",
    })).filter((b) => b.box_id);

    const boxById = new Map<string, { device: string; box_no: string; location: string }>();
    for (const b of boxesList) boxById.set(b.box_id, { device: b.device, box_no: b.box_no, location: b.location });

    const boxIds = Array.from(boxById.keys());
    if (boxIds.length === 0) {
      return NextResponse.json({
        ok: true,
        devices,
        kpi: { devices: devices.length, boxes: 0, items: 0 },
        stock: [],
        imports: [],
        movements: [],
        filter: { device: deviceFilter || "" },
      });
    }

    /* =========================
       3) Items IN for these boxes
       (stock réel)
    ========================= */
    // chunk because .in() has limits
    const chunkSize = 500;
    const itemsIN: Array<{ box_id: string; status: string }> = [];

    for (let i = 0; i < boxIds.length; i += chunkSize) {
      const part = boxIds.slice(i, i + chunkSize);

      const { data: items, error: itemsErr } = await admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_BOX_ID_COL}, ${ITEMS_STATUS_COL}`)
        .in(ITEMS_BOX_ID_COL, part);

      if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

      for (const it of items || []) {
        itemsIN.push({
          box_id: safeStr((it as any)[ITEMS_BOX_ID_COL]),
          status: safeStr((it as any)[ITEMS_STATUS_COL]).toUpperCase(),
        });
      }
    }

    // Aggregate stock by device
    const stockMap = new Map<string, { device: string; boxes: Set<string>; items: number }>();

    for (const it of itemsIN) {
      if (it.status !== STATUS_IN) continue;
      const b = boxById.get(it.box_id);
      if (!b) continue;

      const row = stockMap.get(b.device) || { device: b.device, boxes: new Set<string>(), items: 0 };
      row.boxes.add(it.box_id);
      row.items += 1;
      stockMap.set(b.device, row);
    }

    const stock = Array.from(stockMap.values())
      .map((x) => ({ device: x.device, boxes: x.boxes.size, items: x.items }))
      .sort((a, b) => a.device.localeCompare(b.device));

    const totalItemsIN = stock.reduce((sum, r) => sum + (Number(r.items) || 0), 0);
    const totalBoxesWithIN = stock.reduce((sum, r) => sum + (Number(r.boxes) || 0), 0);

    /* =========================
       4) Optional: last imports + last movements
       (safe: if tables don't exist -> empty)
    ========================= */
    let imports: any[] = [];
    let movements: any[] = [];

    // imports
    const impTry = await admin
      .from(IMPORT_HISTORY_TABLE)
      .select("created_at, vendor, device, box_no, qty")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!impTry.error) imports = impTry.data ?? [];

    // movements
    const movTry = await admin
      .from(MOVEMENT_HISTORY_TABLE)
      .select("created_at, type, device, box_no, imei")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!movTry.error) movements = movTry.data ?? [];

    /* ---------- Response ---------- */
    return NextResponse.json({
      ok: true,
      devices,
      kpi: {
        devices: devices.length,
        boxes: totalBoxesWithIN,
        items: totalItemsIN,
      },
      stock,
      imports,
      movements,
      filter: { device: deviceFilter || "" },
    });
  } catch (e: any) {
    console.error("Dashboard error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}