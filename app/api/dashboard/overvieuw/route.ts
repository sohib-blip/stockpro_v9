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

    // -------------------------
    // Load all base tables
    // -------------------------

    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("status, device_id, box_id");

    if (itemsErr) throw itemsErr;

    const { data: devices, error: devErr } = await supabase
      .from("devices")
      .select("device_id, device, min_stock");

    if (devErr) throw devErr;

    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id");

    if (boxErr) throw boxErr;

    const safeItems = items ?? [];
    const safeDevices = devices ?? [];
    const safeBoxes = boxes ?? [];

    // -------------------------
    // GLOBAL KPIs
    // -------------------------

    const totalIn = safeItems.filter(i => i.status === "IN").length;
    const totalOut = safeItems.filter(i => i.status === "OUT").length;

    // -------------------------
    // DEVICE SUMMARY
    // -------------------------

    const deviceSummary = safeDevices.map(d => {
      const inCount = safeItems.filter(
        i => i.device_id === d.device_id && i.status === "IN"
      ).length;

      const outCount = safeItems.filter(
        i => i.device_id === d.device_id && i.status === "OUT"
      ).length;

      let level: "ok" | "low" | "empty" = "ok";

      if (inCount === 0) level = "empty";
      else if (d.min_stock && inCount <= d.min_stock) level = "low";

      return {
        device_id: d.device_id, // IMPORTANT pour drilldown
        device: d.device,
        total_in: inCount,
        total_out: outCount,
        min_stock: d.min_stock ?? 0,
        level,
      };
    });

    const alertCount = deviceSummary.filter(d => d.level !== "ok").length;

    // -------------------------
    // BOX SUMMARY
    // -------------------------

    const boxSummary = safeBoxes.map(b => {
      const inCount = safeItems.filter(
        i => i.box_id === b.id && i.status === "IN"
      ).length;

      const total = safeItems.filter(
        i => i.box_id === b.id
      ).length;

      const percent =
        total > 0 ? Math.round((inCount / total) * 100) : 0;

      let level: "ok" | "low" | "empty" = "ok";

      if (inCount === 0) level = "empty";
      else if (percent < 30) level = "low";

      const deviceName =
        safeDevices.find(d => d.device_id === b.bin_id)?.device ?? "";

      return {
        box_id: b.id,
        device: deviceName,
        box_code: b.box_code,
        remaining: inCount,
        total,
        percent,
        level,
      };
    });

    return NextResponse.json({
      ok: true,
      kpis: {
        total_in: totalIn,
        total_out: totalOut,
        total_devices: safeDevices.length,
        alerts: alertCount,
      },
      deviceSummary,
      boxSummary,
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? "Dashboard overview failed",
    }, { status: 500 });
  }
}