import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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

    // -------- GLOBAL COUNTS --------
    const { data: items } = await supabase
      .from("items")
      .select("status, device_id, box_id");

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device, min_stock");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id");

    const totalIn = items?.filter(i => i.status === "IN").length ?? 0;
    const totalOut = items?.filter(i => i.status === "OUT").length ?? 0;

    // -------- DEVICE SUMMARY --------
    const deviceSummary = devices?.map(d => {
      const inCount =
        items?.filter(
          i => i.device_id === d.device_id && i.status === "IN"
        ).length ?? 0;

      const outCount =
        items?.filter(
          i => i.device_id === d.device_id && i.status === "OUT"
        ).length ?? 0;

      let level: "ok" | "low" | "empty" = "ok";

      if (inCount === 0) level = "empty";
      else if (d.min_stock && inCount <= d.min_stock) level = "low";

      return {
        device: d.device,
        total_in: inCount,
        total_out: outCount,
        min_stock: d.min_stock ?? 0,
        level,
      };
    }) ?? [];

    const alertCount = deviceSummary.filter(d => d.level !== "ok").length;

    // -------- BOX SUMMARY --------
    const boxSummary = boxes?.map(b => {
      const inCount =
        items?.filter(
          i => i.box_id === b.id && i.status === "IN"
        ).length ?? 0;

      const total =
        items?.filter(
          i => i.box_id === b.id
        ).length ?? 0;

      const percent =
        total > 0 ? Math.round((inCount / total) * 100) : 0;

      let level: "ok" | "low" | "empty" = "ok";

      if (inCount === 0) level = "empty";
      else if (percent < 30) level = "low";

      const deviceName =
        devices?.find(d => d.device_id === b.bin_id)?.device ?? "";

      return {
        device: deviceName,
        box_code: b.box_code,
        remaining: inCount,
        total,
        percent,
        level,
      };
    }) ?? [];

    return NextResponse.json({
      ok: true,
      kpis: {
        total_in: totalIn,
        total_out: totalOut,
        total_devices: devices?.length ?? 0,
        alerts: alertCount,
      },
      deviceSummary,
      boxSummary,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}