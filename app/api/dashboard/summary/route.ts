import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const [{ count: totalImei }, { count: totalBoxes }, { count: totalBins }, { data: alertsRows }] =
    await Promise.all([
      supabase.from("items").select("*", { count: "exact", head: true }).eq("status", "IN"),
      supabase.from("boxes").select("*", { count: "exact", head: true }),
      supabase.from("bins").select("*", { count: "exact", head: true }).eq("active", true),
      supabase.from("dashboard_bins_view").select("device_id").in("level", ["low", "empty"]),
    ]);

  return NextResponse.json({
    ok: true,
    kpis: {
      total_bins: totalBins ?? 0,
      total_boxes: totalBoxes ?? 0,
      total_imei: totalImei ?? 0,
      alerts: alertsRows?.length ?? 0,
    },
  });
}