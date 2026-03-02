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
    const { box_code, target_floor } = await req.json();

    if (!box_code) {
      return NextResponse.json({ ok: false, error: "Box code required" });
    }

    if (!target_floor) {
      return NextResponse.json({ ok: false, error: "Target floor required" });
    }

    const { data: sourceBox, error: boxErr } = await supabase
      .from("boxes")
      .select("id, bin_id, floor")
      .eq("box_code", box_code)
      .maybeSingle();

    if (boxErr) throw boxErr;
    if (!sourceBox) {
      return NextResponse.json({ ok: false, error: "Box not found" });
    }

    if (sourceBox.floor === target_floor) {
      return NextResponse.json({
        ok: false,
        error: "Box already on that floor",
      });
    }

    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("item_id, imei")
      .eq("box_id", sourceBox.id)
      .eq("status", "IN");

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No IN items in this box",
      });
    }

    return NextResponse.json({
      ok: true,
      box_code,
      from_floor: sourceBox.floor,
      to_floor: target_floor,
      total: items.length,
      item_ids: items.map((i) => i.item_id),
      imeis: items.map((i) => i.imei),
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "Box preview failed",
    });
  }
}