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
    // LOAD BOXES
    // ======================
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, bin_id, box_code, floor");

    if (boxErr) throw boxErr;

    // ======================
    // LOAD ITEMS
    // ======================
    const { data: items, error: itemErr } = await supabase
      .from("items")
      .select("imei, box_id, status");

    if (itemErr) throw itemErr;

    // ======================
    // MAP BOXES
    // ======================
    const boxMap = new Map<string, any>();
    for (const b of boxes || []) boxMap.set(String(b.id), b);

    const binTotals: Record<string, number> = {};
    const binOutTotals: Record<string, number> = {};
    const boxTotals: Record<string, number> = {};

    for (const it of items || []) {
      const box = boxMap.get(String(it.box_id));
      if (!box) continue;

      const bin_id = String(box.bin_id);

      if (it.status === "IN") {
        binTotals[bin_id] = (binTotals[bin_id] || 0) + 1;
        boxTotals[String(box.id)] = (boxTotals[String(box.id)] || 0) + 1;
      }

      if (it.status === "OUT") {
        binOutTotals[bin_id] = (binOutTotals[bin_id] || 0) + 1;
      }
    }

    // ======================
    // DEVICE SUMMARY
    // ======================
    const deviceSummary = (bins || []).map((b) => {
      const bin_id = String(b.id);
      const total_in = binTotals[bin_id] || 0;
      const total_out = binOutTotals[bin_id] || 0;
      const min_stock = Number(b.min_stock ?? 0);

      const level = computeLevel(total_in, min_stock);

      return {
        device_id: bin_id,
        device: b.name,
        total_in,
        total_out,
        min_stock,
        level,
      };
    });

    // ======================
    // BOX SUMMARY
    // ======================
    const binNameById = new Map<string, string>();
    for (const b of bins || []) binNameById.set(String(b.id), String(b.name || ""));

    const boxSummary = (boxes || []).map((b) => {
      const remaining = boxTotals[String(b.id)] || 0;
      const total = remaining;
      const percent = total > 0 ? 100 : 0;

      return {
        box_id: String(b.id),
        device_id: String(b.bin_id),
        device: binNameById.get(String(b.bin_id)) || "",
        box_code: String(b.box_code || ""),
        floor: b.floor ?? null,
        remaining,
        total,
        percent,
        level: remaining === 0 ? "empty" : "ok",
      };
    });

    // ======================
    // KPIs
    // ======================
    const total_in = Object.values(binTotals).reduce((a, b) => a + b, 0);
    const total_out = Object.values(binOutTotals).reduce((a, b) => a + b, 0);
    const alerts = deviceSummary.filter((d) => d.level !== "ok").length;

    const kpis = {
      total_in,
      total_out,
      total_devices: bins?.length || 0,
      total_boxes: boxes?.length || 0,
      alerts,
    };

    return NextResponse.json(
      { ok: true, kpis, deviceSummary, boxSummary },
      {
        headers: {
          // 🔥 kill ALL caches
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Dashboard failed" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  }
}