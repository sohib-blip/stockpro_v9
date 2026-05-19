import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function extractImeis(text: string) {
  return Array.from(
    new Set(
      String(text || "")
        .split(/\s+/)
        .map((x) => x.replace(/\D/g, ""))
        .filter((x) => x.length === 15)
    )
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const imeis = extractImeis(body.imeisText || body.imeis || "");

    if (imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "No valid IMEIs found" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("items")
      .select(`
        item_id,
        imei,
        status,
        box_id,
        device_id,
        boxes (
          box_code,
          floor,
          bins (
            name
          )
        )
      `)
      .in("imei", imeis);

    if (error) throw error;

    const foundMap = new Map((data || []).map((x: any) => [String(x.imei), x]));

    const valid_returns: any[] = [];
    const already_in_stock: string[] = [];
    const unknown_imeis: string[] = [];

    for (const imei of imeis) {
      const item: any = foundMap.get(imei);

      if (!item) {
        unknown_imeis.push(imei);
        continue;
      }

      if (String(item.status).toUpperCase() === "IN") {
        already_in_stock.push(imei);
        continue;
      }

      if (String(item.status).toUpperCase() === "OUT") {
        valid_returns.push({
          item_id: item.item_id,
          imei: item.imei,
          device_id: item.device_id,
          device: item.boxes?.bins?.name || item.device_id,
          previous_box: item.boxes?.box_code || "",
          previous_floor: item.boxes?.floor || "",
        });
      }
    }

    const breakdown: Record<string, number> = {};
    for (const item of valid_returns) {
      breakdown[item.device] = (breakdown[item.device] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      total_scanned: imeis.length,
      valid_returns,
      already_in_stock,
      unknown_imeis,
      breakdown: Object.entries(breakdown).map(([device, qty]) => ({ device, qty })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Return preview failed" },
      { status: 500 }
    );
  }
}