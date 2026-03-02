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
    const { items, target_floor, actor, actor_id } = await req.json();

    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ ok: false, error: "No items" });

    if (!target_floor)
      return NextResponse.json({ ok: false, error: "Target floor required" });

    const nowIso = new Date().toISOString();
    let moved = 0;

    for (const row of items) {
      const { item_id, box_code, bin_id } = row;

      // 1️⃣ Find or create box on target floor
      let { data: targetBox } = await supabase
        .from("boxes")
        .select("id")
        .eq("box_code", box_code)
        .eq("bin_id", bin_id)
        .eq("floor", target_floor)
        .maybeSingle();

      if (!targetBox) {
        const { data: newBox, error } = await supabase
          .from("boxes")
          .insert({
            box_code,
            bin_id,
            floor: target_floor,
          })
          .select("id")
          .single();

        if (error) throw error;
        targetBox = newBox;
      }

      // 2️⃣ Update item
      const { error: updErr } = await supabase
        .from("items")
        .update({ box_id: targetBox.id })
        .eq("item_id", item_id);

      if (updErr) throw updErr;

      // 3️⃣ Movement log
      await supabase.from("movements").insert({
        type: "TRANSFER",
        item_id,
        box_id: targetBox.id,
        qty: 1,
        created_by: actor_id,
        actor,
        notes: `floor_transfer_to_${target_floor}`,
        created_at: nowIso,
      });

      moved++;
    }

    return NextResponse.json({ ok: true, moved });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}