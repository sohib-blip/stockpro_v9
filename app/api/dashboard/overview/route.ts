import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {

    // =========================
    // 1️⃣ DEVICE STOCK + OUTBOUND
    // =========================

    const { data: deviceSummary, error } = await supabase
      .from("dashboard_device_flow_view")
      .select("*");

    if (error) throw error;

    // =========================
    // 2️⃣ BOX SUMMARY
    // =========================

    const { data: boxSummary } = await supabase
      .from("dashboard_stock_view")
      .select("*");

    // =========================
    // 3️⃣ KPIs
    // =========================

    const total_in =
      deviceSummary?.reduce((a,d)=>a+d.total_in,0) || 0;

    const total_out =
      deviceSummary?.reduce((a,d)=>a+d.total_out,0) || 0;

    const kpis = {
      total_in,
      total_out,
      total_devices: deviceSummary?.length || 0,
      total_boxes: boxSummary?.length || 0,
    };

    // =========================
    // 4️⃣ RECENT MOVEMENTS
    // =========================

    const { data: movements } = await supabase
      .from("movements")
      .select("type, device, created_at")
      .order("created_at",{ascending:false})
      .limit(10);

    // =========================
    // RESPONSE
    // =========================

    return NextResponse.json({
      ok: true,
      kpis,
      deviceSummary,
      boxSummary,
      activity: movements
    });

  } catch (e:any) {

    return NextResponse.json(
      { ok:false, error:e.message },
      { status:500 }
    );

  }
}