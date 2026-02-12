// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const user = authedClient(token);
    const { error: authErr } = await user.auth.getUser();
    if (authErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });

    const url = new URL(req.url);
    const deviceFilter = String(url.searchParams.get("device") || "").trim(); // display name

    // devices list (menu dropdown)
    const { data: devices } = await admin.from("devices").select("device_id, device").eq("active", true);
    const devicesList = (devices || []).map((d: any) => d.device);

    // resolve device_id filter
    let device_id: string | null = null;
    if (deviceFilter) {
      const found = (devices || []).find((d: any) => d.device === deviceFilter);
      device_id = found?.device_id ?? null;
      if (!device_id) return NextResponse.json({ ok: true, devices: devicesList, kpi: { devices: devicesList.length, boxes: 0, items: 0 }, stock: [], by_location: [] });
    }

    // KPI (IN only)
    let boxesQuery = admin.from("boxes").select("box_id", { count: "exact", head: true }).eq("status", "IN");
    let itemsQuery = admin.from("items").select("imei", { count: "exact", head: true }).eq("status", "IN");

    if (device_id) {
      boxesQuery = boxesQuery.eq("device_id", device_id);
      itemsQuery = itemsQuery.eq("device_id", device_id);
    }

    const [boxesCountRes, itemsCountRes] = await Promise.all([boxesQuery, itemsQuery]);

    // Stock par device (IN only)
    const { data: stockRows, error: stockErr } = await admin
      .rpc("dashboard_stock_by_device_in", { p_device_id: device_id }); // ✅ RPC (voir juste en dessous)
    if (stockErr) throw new Error(stockErr.message);

    // Stock par étage
    const { data: locRows, error: locErr } = await admin
      .rpc("dashboard_stock_by_location_in", { p_device_id: device_id }); // ✅ RPC
    if (locErr) throw new Error(locErr.message);

    return NextResponse.json({
      ok: true,
      devices: devicesList,
      kpi: {
        devices: devicesList.length,
        boxes: boxesCountRes.count ?? 0,
        items: itemsCountRes.count ?? 0,
      },
      stock: stockRows || [],
      by_location: locRows || [],
      imports: [], // on branchera après
      movements: [],
    });
  } catch (e: any) {
    console.error("Dashboard error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}