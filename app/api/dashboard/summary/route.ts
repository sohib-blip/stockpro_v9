import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = sb();

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device, canonical_name, min_stock, active");

    const { data: items } = await supabase
      .from("items")
      .select("device_id, box_id");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, floor");

    const boxFloorMap: Record<string, string> = {};
    for (const b of boxes || []) {
      boxFloorMap[String((b as any).box_id)] = (b as any).floor || "";
    }

    const byDevice: Record<
      string,
      { boxes: Set<string>; imeis: number; floors: Set<string> }
    > = {};

    for (const it of items || []) {
      const did = String((it as any).device_id);
      const bid = String((it as any).box_id);

      if (!byDevice[did]) {
        byDevice[did] = {
          boxes: new Set(),
          imeis: 0,
          floors: new Set(),
        };
      }

      byDevice[did].imeis += 1;
      byDevice[did].boxes.add(bid);

      const floor = boxFloorMap[bid];
      if (floor) byDevice[did].floors.add(floor);
    }

    const rows = (devices || [])
      .filter((d: any) => d.active !== false)
      .map((d: any) => {
        const did = String(d.device_id);
        const data = byDevice[did];

        const imeis = data?.imeis ?? 0;
        const boxesCount = data?.boxes.size ?? 0;
        const floors = data ? Array.from(data.floors) : [];

        const low = imeis < (d.min_stock || 0);

        return {
          device_id: did,
          device: d.device || d.canonical_name,
          canonical_name: d.canonical_name,
          imeis,
          boxes: boxesCount,
          floors,
          low_stock: low,
        };
      });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Summary failed" },
      { status: 500 }
    );
  }
}