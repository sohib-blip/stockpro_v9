import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error(
      "Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

/**
 * Attendu DB (minimal):
 * - devices: device_id, device, canonical_name, min_stock, units_per_imei, active
 * - items: device_id, box_id (au minimum)
 * - boxes: box_id, box_no (facultatif pour ce summary)
 */
export async function GET() {
  try {
    const supabase = sb();

    const { data: devices, error: devErr } = await supabase
      .from("devices")
      .select("device_id, device, canonical_name, min_stock, units_per_imei, active")
      .order("canonical_name", { ascending: true });

    if (devErr) throw devErr;

    const activeDevices = (devices || []).filter((d) => d.active !== false);

    // On récupère les items par device (compte)
    // ⚠️ Si ta table items n’a pas device_id, dis-le moi et je l’adapte direct.
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("device_id, box_id");

    if (itemsErr) throw itemsErr;

    const byDevice: Record<
      string,
      { boxes: Set<string>; imeiCount: number }
    > = {};

    for (const it of items || []) {
      const did = String((it as any).device_id ?? "");
      if (!did) continue;

      if (!byDevice[did]) {
        byDevice[did] = { boxes: new Set<string>(), imeiCount: 0 };
      }

      byDevice[did].imeiCount += 1;

      const bid = (it as any).box_id;
      if (bid) byDevice[did].boxes.add(String(bid));
    }

    const rows = activeDevices.map((d) => {
      const did = String(d.device_id);
      const imeiCount = byDevice[did]?.imeiCount ?? 0;
      const boxesCount = byDevice[did]?.boxes.size ?? 0;

      const units = Number(d.units_per_imei ?? 1) || 1;
      const itemsCount = imeiCount * units;

      const min = Number(d.min_stock ?? 0) || 0;
      const low = min > 0 && itemsCount < min;

      return {
        device_id: did,
        device: d.device || d.canonical_name || did,
        canonical_name: d.canonical_name,
        units_per_imei: units,
        min_stock: min,
        imeis: imeiCount,
        boxes: boxesCount,
        items: itemsCount,
        low_stock: low,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.devices += 1;
        acc.boxes += r.boxes;
        acc.imeis += r.imeis;
        acc.items += r.items;
        acc.low += r.low_stock ? 1 : 0;
        return acc;
      },
      { devices: 0, boxes: 0, imeis: 0, items: 0, low: 0 }
    );

    return NextResponse.json({ ok: true, totals, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Dashboard summary failed" },
      { status: 500 }
    );
  }
}