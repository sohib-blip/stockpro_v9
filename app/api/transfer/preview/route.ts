import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const { imeis, target_floor } = await req.json();

    if (!Array.isArray(imeis) || imeis.length === 0)
      return NextResponse.json({ ok: false, error: "No IMEIs" });

    if (!target_floor)
      return NextResponse.json({ ok: false, error: "Target floor required" });

    const { data: items, error } = await supabase
      .from("items")
      .select(`
        item_id,
        imei,
        status,
        box_id,
        boxes (
          id,
          box_code,
          floor,
          bin_id
        )
      `)
      .in("imei", imeis)
      .eq("status", "IN");

    if (error) throw error;
    if (!items || items.length === 0)
      return NextResponse.json({ ok: false, error: "No valid IN items" });

    const rows = items.map((i: any) => ({
      imei: i.imei,
      from_box: i.boxes?.box_code,
      from_floor: i.boxes?.floor,
      to_floor: target_floor,
      box_code: i.boxes?.box_code,
      bin_id: i.boxes?.bin_id,
      item_id: i.item_id,
    }));

    return NextResponse.json({
      ok: true,
      rows,
      payload: rows.map((r: any) => ({
        item_id: r.item_id,
        box_code: r.box_code,
        bin_id: r.bin_id,
      })),
      target_floor,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}