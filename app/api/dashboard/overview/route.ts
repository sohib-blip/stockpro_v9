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

    // =========================
    // 1️⃣ LOAD OUTBOUND COUNTS
    // =========================

    const { data: outItems } = await supabase
      .from("items")
      .select("box_id")
      .eq("status", "OUT");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, bin_id");

    const boxToBin: Record<string, string> = {};

    for (const box of boxes || []) {
      boxToBin[box.box_id] = box.bin_id;
    }

    const outMap: Record<string, number> = {};

    for (const item of outItems || []) {

      const binId = boxToBin[item.box_id];

      if (!binId) continue;

      outMap[binId] = (outMap[binId] || 0) + 1;

    }

    // =========================
    // 2️⃣ LOAD CURRENT STOCK
    // =========================

    const { data, error } = await supabase
      .from("dashboard_stock_view")
      .select("*");

    if (error) throw error;

    const binTotals: Record<string, number> = {};
    const deviceSummary: any[] = [];
    const boxSummary: any[] = [];

    // =========================
    // 3️⃣ BUILD BOX SUMMARY
    // =========================

    for (const row of data || []) {

      const binId = String(row.bin_id);
      const totalIn = Number(row.total_in || 0);

      binTotals[binId] = (binTotals[binId] || 0) + totalIn;

      if (row.box_id) {
        boxSummary.push({
          box_id: String(row.box_id),
          device_id: binId,
          device: row.bin_name,
          box_code: row.box_code,
          floor: row.floor,
          remaining: totalIn,
          total: totalIn,
          percent: totalIn > 0 ? 100 : 0,
          level: totalIn === 0 ? "empty" : "ok",
        });
      }

    }

    // =========================
    // 4️⃣ BUILD DEVICE SUMMARY
    // =========================

    const uniqueBins = new Map<string, any>();

    for (const row of data || []) {

      const binId = String(row.bin_id);

      if (!uniqueBins.has(binId)) {
        uniqueBins.set(binId, {
          device_id: binId,
          device: row.bin_name,
          min_stock: Number(row.min_stock || 0),
        });
      }

    }

    for (const [binId, info] of uniqueBins.entries()) {

      const totalIn = binTotals[binId] || 0;

      const level = computeLevel(totalIn, info.min_stock);

      deviceSummary.push({
        device_id: binId,
        device: info.device,
        total_in: totalIn,
        total_out: outMap[binId] || 0,
        min_stock: info.min_stock,
        level,
      });

    }

    // =========================
    // 5️⃣ GLOBAL KPIs
    // =========================

    const totalInAll = Object.values(binTotals).reduce((a, b) => a + b, 0);

    const totalOutAll = Object.values(outMap).reduce((a, b) => a + b, 0);

    const alerts = deviceSummary.filter(d => d.level !== "ok").length;

    const kpis = {
      total_in: totalInAll,
      total_out: totalOutAll,
      total_devices: deviceSummary.length,
      total_boxes: boxSummary.length,
      alerts,
    };

    // =========================
    // 6️⃣ RECENT MOVEMENTS
    // =========================

    const { data: movements } = await supabase
      .from("movements")
      .select("type, device, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    // =========================
    // RESPONSE
    // =========================

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
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
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