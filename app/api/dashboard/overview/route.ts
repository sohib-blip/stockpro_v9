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
    // LOAD BINS (ACTIVE)
    // ======================
    const { data: bins, error: binsErr } = await supabase
      .from("bins")
      .select("id, name, min_stock, active")
      .eq("active", true);

    if (binsErr) throw binsErr;

    // ======================
    // COUNT ITEMS PER BOX (ONLY IN STOCK)
    // ======================
    const { data: boxCounts, error: boxCountErr } = await supabase
      .from("items")
      .select("box_id, status")
      .eq("status", "IN");

    if (boxCountErr) throw boxCountErr;

    // ======================
    // LOAD BOXES
    // ======================
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, bin_id, box_code, floor");

    if (boxErr) throw boxErr;

    // ======================
    // COUNT LOGIC
    // ======================
    const boxTotals: Record<string, number> = {};
    for (const it of boxCounts || []) {
      boxTotals[String(it.box_id)] =
        (boxTotals[String(it.box_id)] || 0) + 1;
    }

    const binTotals: Record<string, number> = {};
    for (const box of boxes || []) {
      const count = boxTotals[String(box.id)] || 0;
      binTotals[String(box.bin_id)] =
        (binTotals[String(box.bin_id)] || 0) + count;
    }

    // ======================
    // DEVICE SUMMARY
    // ======================
    const deviceSummary = (bins || []).map((b) => {
      const bin_id = String(b.id);
      const total_in = binTotals[bin_id] || 0;
      const min_stock = Number(b.min_stock ?? 0);

      const level =
        total_in <= 0
          ? "empty"
          : min_stock > 0 && total_in <= min_stock
          ? "low"
          : "ok";

      return {
        device_id: bin_id,
        device: b.name,
        total_in,
        total_out: 0, // simplified
        min_stock,
        level,
      };
    });

    // ======================
    // BOX SUMMARY
    // ======================
    const binNameById = new Map<string, string>();
    for (const b of bins || [])
      binNameById.set(String(b.id), String(b.name || ""));

    const boxSummary = (boxes || []).map((b) => {
      const remaining = boxTotals[String(b.id)] || 0;

      return {
        box_id: String(b.id),
        device_id: String(b.bin_id),
        device: binNameById.get(String(b.bin_id)) || "",
        box_code: String(b.box_code || ""),
        floor: b.floor ?? null,
        remaining,
        total: remaining,
        percent: remaining > 0 ? 100 : 0,
        level: remaining === 0 ? "empty" : "ok",
      };
    });

    // ======================
    // KPIs
    // ======================
    const total_in = Object.values(binTotals).reduce(
      (a, b) => a + b,
      0
    );

    const alerts = deviceSummary.filter(
      (d) => d.level !== "ok"
    ).length;

    const kpis = {
      total_in,
      total_out: 0,
      total_devices: bins?.length || 0,
      total_boxes: boxes?.length || 0,
      alerts,
    };

    return NextResponse.json(
      { ok: true, kpis, deviceSummary, boxSummary },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",
          Pragma: "no-cache",
          Expires: "0",
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