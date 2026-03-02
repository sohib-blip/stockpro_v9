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
    const { box_code, target_floor, actor, actor_id } = await req.json();

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
      return NextResponse.json({ ok: false, error: "Source box not found" });
    }

    if (sourceBox.floor === target_floor) {
      return NextResponse.json({
        ok: false,
        error: "Box already on that floor",
      });
    }

    // Get items IN
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("item_id")
      .eq("box_id", sourceBox.id)
      .eq("status", "IN");

    if (itemsErr) throw itemsErr;
    if (!items || items.length === 0) {
      return NextResponse.json({
        ok: false,
        error: "No IN items in this box",
      });
    }

    // Find or create target box
    let { data: targetBox } = await supabase
      .from("boxes")
      .select("id")
      .eq("box_code", box_code)
      .eq("bin_id", sourceBox.bin_id)
      .eq("floor", target_floor)
      .maybeSingle();

    if (!targetBox) {
      const { data: newBox, error: newErr } = await supabase
        .from("boxes")
        .insert({
          box_code,
          bin_id: sourceBox.bin_id,
          floor: target_floor,
        })
        .select("id")
        .single();

      if (newErr) throw newErr;
      targetBox = newBox;
    }

    // Update items
    await supabase
      .from("items")
      .update({ box_id: targetBox.id })
      .in(
        "item_id",
        items.map((i: any) => i.item_id)
      );

    // Log movements
    const nowIso = new Date().toISOString();

    await supabase.from("movements").insert(
      items.map((i: any) => ({
        type: "TRANSFER",
        item_id: i.item_id,
        box_id: targetBox.id,
        qty: 1,
        created_by: actor_id,
        actor,
        notes: `box_transfer_to_${target_floor}`,
        created_at: nowIso,
      }))
    );

    return NextResponse.json({
      ok: true,
      moved: items.length,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "Box transfer failed",
    });
  }
}