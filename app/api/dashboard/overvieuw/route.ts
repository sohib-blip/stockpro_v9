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
    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id, floor");

    const { data: items } = await supabase
      .from("items")
      .select("imei, status, device_id, box_id, imported_at, imported_by");

    const safeDevices = devices ?? [];
    const safeBoxes = boxes ?? [];
    const safeItems = items ?? [];

    const deviceSummary = safeDevices.map(d => {
      const deviceBoxes = safeBoxes.filter(b => b.bin_id === d.device_id);
      const deviceItems = safeItems.filter(i =>
        i.device_id === d.device_id && i.status === "IN"
      );

      const floors = Array.from(
        new Set(deviceBoxes.map(b => b.floor).filter(Boolean))
      );

      return {
        device_id: d.device_id,
        device: d.device,
        total_imei: deviceItems.length,
        total_boxes: deviceBoxes.length,
        floors,
      };
    });

    return NextResponse.json({
      ok: true,
      kpis: {
        total_devices: safeDevices.length,
        total_imei: safeItems.filter(i => i.status === "IN").length,
        total_boxes: safeBoxes.length,
        total_floors: Array.from(
          new Set(safeBoxes.map(b => b.floor))
        ).length,
      },
      deviceSummary,
      boxes: safeBoxes,
      items: safeItems,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}