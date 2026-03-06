import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

type Level = "ok" | "low" | "empty";

export async function GET() {
  try {
    const supabase = sb();

    // ======================
    // LOAD AGGREGATED STOCK
    // ======================
    const { data, error } = await supabase
      .from("dashboard_stock_view")
      .select("*");

    if (error) throw error;

    // ======================
    // LOAD OUTBOUND COUNTS
    // ======================
    const { data: outMovements, error: outErr } = await supabase
      .from("movements")
      .select("device")
      .eq("type", "OUT");

    if (outErr) throw outErr;

    const outMap: Record<string, number> = {};

    for (const m of outMovements || []) {
      const device = String((m as any).device || "");
      outMap[device] = (outMap[device] || 0) + 1;
    }

    const binTotals: Record<string, number> = {};
    const deviceSummary: any[] = [];
    const boxSummary: any[] = [];

    for (const row of data || []) {
      const bin_id = String((row as any).bin_id);
      const total_in = Number((row as any).total_in || 0);

      // accumulate per bin
      binTotals[bin_id] = (binTotals[bin_id] || 0) + total_in;

      // box summary
      if ((row as any).box_id) {
        boxSummary.push({
          box_id: String((row as any).box_id),
          device_id: bin_id,
          device: (row as any).bin_name,
          box_code: (row as any).box_code,
          floor: (row as any).floor,
          remaining: total_in,
          total: total_in,
          percent: total_in > 0 ? 100 : 0,
          level: total_in === 0 ? "empty" : "ok",
        });
      }
    }

    // build device summary
    const uniqueBins = new Map<string, any>();

    for (const row of data || []) {
      const bin_id = String((row as any).bin_id);

      if (!uniqueBins.has(bin_id)) {
        uniqueBins.set(bin_id, {
          device_id: bin_id,
          device: (row as any).bin_name,
          min_stock: Number((row as any).min_stock || 0),
        });
      }
    }

    for (const [bin_id, info] of uniqueBins.entries()) {
      const total_in = binTotals[bin_id] || 0;
      const min_stock = info.min_stock;

      const level: Level =
        total_in <= 0
          ? "empty"
          : min_stock > 0 && total_in <= min_stock
          ? "low"
          : "ok";

      deviceSummary.push({
        device_id: bin_id,
        device: info.device,
        total_in,
        total_out: outMap[info.device] || 0,
        min_stock,
        level,
      });
    }

    const total_in_all = Object.values(binTotals).reduce(
      (a, b) => a + b,
      0
    );

    const total_out_all = Object.values(outMap).reduce(
      (a, b) => a + b,
      0
    );

    const alerts = deviceSummary.filter(
      (d) => d.level !== "ok"
    ).length;

    const kpis = {
      total_in: total_in_all,
      total_out: total_out_all,
      total_devices: deviceSummary.length,
      total_boxes: boxSummary.length,
      alerts,
    };

    // ======================
    // LOAD RECENT MOVEMENTS
    // ======================
    const { data: movements } = await supabase
      .from("movements")
      .select("type, device, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json(
      {
        ok: true,
        kpis,
        deviceSummary,
        boxSummary,
        activity: movements,
      },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Dashboard failed" },
      { status: 500 }
    );
  }
}