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

function computeLevel(totalIn: number, minStock: number): Level {
  if (totalIn <= 0) return "empty";
  if (minStock > 0 && totalIn <= minStock) return "low";
  return "ok";
}

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

    const binTotals: Record<string, number> = {};
    const deviceSummary: any[] = [];
    const boxSummary: any[] = [];

    for (const row of data || []) {
      const bin_id = String(row.bin_id);
      const total_in = Number(row.total_in || 0);
      const min_stock = Number(row.min_stock || 0);

      // accumulate per bin
      binTotals[bin_id] =
        (binTotals[bin_id] || 0) + total_in;

      // box summary
      if (row.box_id) {
        boxSummary.push({
          box_id: String(row.box_id),
          device_id: bin_id,
          device: row.bin_name,
          box_code: row.box_code,
          floor: row.floor,
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
      const bin_id = String(row.bin_id);
      if (!uniqueBins.has(bin_id)) {
        uniqueBins.set(bin_id, {
          device_id: bin_id,
          device: row.bin_name,
          min_stock: Number(row.min_stock || 0),
        });
      }
    }

    for (const [bin_id, info] of uniqueBins.entries()) {
      const total_in = binTotals[bin_id] || 0;
      const min_stock = info.min_stock;

      const level =
        total_in <= 0
          ? "empty"
          : min_stock > 0 && total_in <= min_stock
          ? "low"
          : "ok";

      deviceSummary.push({
        device_id: bin_id,
        device: info.device,
        total_in,
        total_out: 0,
        min_stock,
        level,
      });
    }

    const total_in_all = Object.values(binTotals).reduce(
      (a, b) => a + b,
      0
    );

    const alerts = deviceSummary.filter(
      (d) => d.level !== "ok"
    ).length;

    const kpis = {
      total_in: total_in_all,
      total_out: 0,
      total_devices: deviceSummary.length,
      total_boxes: boxSummary.length,
      alerts,
    };

    return NextResponse.json(
      { ok: true, kpis, deviceSummary, boxSummary },
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