// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* =========================
   GET /api/dashboard
   Query params:
   - device: filter (exact match display name)
   - q: search (ilike) in display device
========================= */
export async function GET(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const token = getBearerToken(req);
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
    const deviceFilter = String(url.searchParams.get("device") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();

    /* =========================
       1) Fetch devices list (dropdown)
       -> basé sur table devices
    ========================= */
    const { data: devicesRows, error: devErr } = await admin
      .from("devices")
      .select("device_id, device, canonical_name, active")
      .order("device", { ascending: true });

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    const devicesList = (devicesRows || [])
      .map((d: any) => String(d?.device || "").trim())
      .filter(Boolean);

    /* =========================
       2) Fetch boxes (source of truth for device display)
       boxes columns (selon tes screenshots):
       - box_id, box_no, device_id, device, location, status, qty ...
    ========================= */
    let boxesQuery = admin
      .from("boxes")
      .select("box_id, device_id, device, location, status");

    // Filter by device
    if (deviceFilter) {
      // prefer filter by boxes.device text (car c'est ce que manual import remplit souvent)
      boxesQuery = boxesQuery.eq("device", deviceFilter);
    } else if (q) {
      boxesQuery = boxesQuery.ilike("device", `%${q}%`);
    }

    const { data: boxes, error: boxErr } = await boxesQuery;
    if (boxErr) {
      return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    }

    const boxIds = (boxes || []).map((b: any) => String(b?.box_id || "")).filter(Boolean);

    /* =========================
       3) Fetch items for these boxes
       items columns:
       - item_id, imei, device_id, box_id, status ...
       IMPORTANT:
       - On ne dépend PAS de items.device_id
       - On utilise items.box_id => join en mémoire
    ========================= */
    let items: any[] = [];
    if (boxIds.length > 0) {
      // chunk safe (IN clause)
      const chunkSize = 500;
      for (let i = 0; i < boxIds.length; i += chunkSize) {
        const chunk = boxIds.slice(i, i + chunkSize);
        const { data, error } = await admin
          .from("items")
          .select("box_id, status")
          .in("box_id", chunk);

        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        items = items.concat(data || []);
      }
    }

    /* =========================
       4) KPI global (basé sur DB entière)
       - devices: count devices
       - boxes: count boxes
       - items: count items
       NB: si tu veux uniquement IN, je te le fais après,
       mais là ton UI montre total items, donc on suit.
    ========================= */
    const [devicesCountRes, boxesCountRes, itemsCountRes] = await Promise.all([
      admin.from("devices").select("device_id", { count: "exact", head: true }),
      admin.from("boxes").select("box_id", { count: "exact", head: true }),
      admin.from("items").select("item_id", { count: "exact", head: true }),
    ]);

    const kpi = {
      devices: devicesCountRes.count ?? 0,
      boxes: boxesCountRes.count ?? 0,
      items: itemsCountRes.count ?? 0,
    };

    /* =========================
       5) Stock par device (Boxes + Items)
       - device display = boxes.device (texte)
       - on compte boxes et items groupés par device display
    ========================= */
    const deviceAgg = new Map<string, { device: string; boxes: number; items: number }>();

    // init per device from devices table (pour que ça affiche même 0)
    for (const name of devicesList) {
      deviceAgg.set(name, { device: name, boxes: 0, items: 0 });
    }

    const itemsByBox: Record<string, number> = {};
    for (const it of items || []) {
      const bid = String((it as any).box_id || "");
      if (!bid) continue;
      itemsByBox[bid] = (itemsByBox[bid] || 0) + 1;
    }

    for (const b of boxes || []) {
      const bid = String((b as any).box_id || "");
      const devName = String((b as any).device || "").trim() || "UNKNOWN";

      const row = deviceAgg.get(devName) || { device: devName, boxes: 0, items: 0 };
      row.boxes += 1;
      row.items += toInt(itemsByBox[bid], 0);
      deviceAgg.set(devName, row);
    }

    const stock = Array.from(deviceAgg.values()).sort((a, b) => a.device.localeCompare(b.device));

    /* =========================
       6) Historique (safe fallback)
       On essaye d'abord audit_events, sinon on renvoie []
    ========================= */
    let history: any[] = [];
    try {
      const { data: ev, error: evErr } = await admin
        .from("audit_events")
        .select("created_at, action, entity, entity_id, payload, created_by")
        .order("created_at", { ascending: false })
        .limit(30);

      if (!evErr) history = ev || [];
    } catch {
      // ignore
      history = [];
    }

    /* ---------- Response ---------- */
    return NextResponse.json({
      ok: true,
      devices: devicesList, // dropdown
      kpi,
      stock,
      history, // tu peux l'afficher quand tu veux
      debug: {
        filtered_boxes: boxIds.length,
        filtered_items: items.length,
        deviceFilter: deviceFilter || null,
        q: q || null,
      },
    });
  } catch (e: any) {
    console.error("Dashboard error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}