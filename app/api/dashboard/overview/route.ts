import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET() {
  try {
    const { data: bins } = await supabase
      .from("bins")
      .select("id, name, min_stock, active");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code, floor, bin_id");

    const { data: items } = await supabase
      .from("items")
      .select("imei, status, device_id, box_id, imported_at, imported_by");

    const imeisIn = items?.filter(i => i.status === "IN") ?? [];

    const kpi = {
      devices: bins?.length ?? 0,
      boxes: boxes?.length ?? 0,
      imeis_in: imeisIn.length,
      low_stock_devices: 0
    };

    const binRows = (bins ?? []).map(bin => {
      const binItems = imeisIn.filter(i => i.device_id === bin.id);
      const binBoxes = boxes?.filter(b => b.bin_id === bin.id) ?? [];

      const floors = [
        ...new Set(binBoxes.map(b => b.floor).filter(Boolean))
      ];

      const isLow =
        bin.min_stock &&
        binItems.length <= bin.min_stock &&
        binItems.length > 0;

      if (isLow) kpi.low_stock_devices++;

      return {
        device_id: bin.id,
        device: bin.name,
        min_stock: bin.min_stock,
        imeis_in: binItems.length,
        boxes_count: binBoxes.length,
        floors,
        is_low: isLow
      };
    });

    return NextResponse.json({
      ok: true,
      kpi,
      bins: binRows
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}