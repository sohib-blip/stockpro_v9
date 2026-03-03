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
    const { box_codes, target_floor } = await req.json();

    if (!Array.isArray(box_codes) || box_codes.length === 0) {
      return NextResponse.json({ ok: false, error: "No box codes provided." });
    }

    if (!target_floor) {
      return NextResponse.json({ ok: false, error: "Target floor required." });
    }

    // Load boxes
    const { data: boxes, error } = await supabase
      .from("boxes")
      .select("box_id, box_code, floor")
      .in("box_code", box_codes);

    if (error) throw error;

    if (!boxes || boxes.length !== box_codes.length) {
      return NextResponse.json({
        ok: false,
        error: "One or more boxes not found.",
      });
    }

    let totalItems = 0;

    for (const box of boxes) {
      if (box.floor === target_floor) {
        return NextResponse.json({
          ok: false,
          error: `Box ${box.box_code} already on floor ${target_floor}`,
        });
      }

      const { count } = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", box.box_id)
        .eq("status", "IN");

      if (!count || count === 0) {
        return NextResponse.json({
          ok: false,
          error: `Box ${box.box_code} is empty.`,
        });
      }

      totalItems += count;
    }

    return NextResponse.json({
      ok: true,
      preview: true,
      total_boxes: boxes.length,
      total_items: totalItems,
      current_floors: boxes.map((b) => ({
        box: b.box_code,
        floor: b.floor,
      })),
      target_floor,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}