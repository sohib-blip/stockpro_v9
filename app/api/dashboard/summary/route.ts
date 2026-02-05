import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

const LOCS = ["00", "1", "6", "Cabinet", "UNKNOWN"] as const;

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    // boxes: need location + device
    const boxesRes = await supabase.from("boxes").select("box_id, device, location, status");
    if (boxesRes.error) return NextResponse.json({ ok: false, error: boxesRes.error.message }, { status: 500 });

    // items: count IN/OUT and per device
    const itemsRes = await supabase.from("items").select("imei, status, box_id");
    if (itemsRes.error) return NextResponse.json({ ok: false, error: itemsRes.error.message }, { status: 500 });

    const boxes = boxesRes.data || [];
    const items = itemsRes.data || [];

    const boxMeta = new Map<string, { device: string; location: string }>();
    for (const b of boxes as any[]) {
      const id = String(b.box_id || "");
      if (!id) continue;
      boxMeta.set(id, {
        device: String(b.device ?? "UNKNOWN"),
        location: String(b.location ?? "UNKNOWN"),
      });
    }

    let items_in = 0;
    let items_out = 0;

    const perDevice = new Map<string, { in_stock: number; out_stock: number }>();
    const perLocationTotal = new Map<string, number>();
    const perDeviceLocation = new Map<string, Record<string, number>>();

    for (const it of items as any[]) {
      const st = String(it.status ?? "").toUpperCase();
      const boxId = String(it.box_id || "");
      const meta = boxMeta.get(boxId);

      const dev = meta?.device || "UNKNOWN";
      const loc = meta?.location || "UNKNOWN";

      const row = perDevice.get(dev) || { in_stock: 0, out_stock: 0 };

      if (st === "IN") {
        items_in++;
        row.in_stock++;

        perLocationTotal.set(loc, (perLocationTotal.get(loc) ?? 0) + 1);

        const m = perDeviceLocation.get(dev) || {};
        m[loc] = (m[loc] ?? 0) + 1;
        perDeviceLocation.set(dev, m);
      } else {
        items_out++;
        row.out_stock++;
      }

      perDevice.set(dev, row);
    }

    const per_device = Array.from(perDevice.entries())
      .map(([device, v]) => ({
        device,
        in_stock: v.in_stock,
        out_stock: v.out_stock,
        total: v.in_stock + v.out_stock,
      }))
      .sort((a, b) => b.in_stock - a.in_stock);

    const per_location = LOCS.map((l) => ({
      location: l,
      in_stock: perLocationTotal.get(l) ?? 0,
    })).sort((a, b) => b.in_stock - a.in_stock);

    const per_device_location = Array.from(perDeviceLocation.entries())
      .map(([device, locMap]) => ({
        device,
        total_in: Object.values(locMap).reduce((acc, n) => acc + (n ?? 0), 0),
        locations: LOCS.map((l) => ({ location: l, in_stock: locMap[l] ?? 0 })),
      }))
      .sort((a, b) => b.total_in - a.total_in);

    const counts = {
      devices: per_device.length,
      items_in,
      items_out,
      boxes: boxes.length,
    };

    return NextResponse.json({
      ok: true,
      counts,
      per_device,
      per_location,
      per_device_location,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
