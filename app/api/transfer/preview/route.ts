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
    const { box_codes, source_bin_id, target_floor } = await req.json();

    if (!Array.isArray(box_codes) || box_codes.length === 0) {
      return NextResponse.json({ ok: false, error: "No box codes provided." });
    }

    if (!target_floor) {
      return NextResponse.json({ ok: false, error: "Target floor required." });
    }

    if (!source_bin_id) {
  return NextResponse.json({ ok: false, error: "Device required." });
}

    const { data: boxes, error } = await supabase
      .from("boxes")
      .select(`
  id,
  box_code,
  floor,
  bin_id,
  bins (
    name
  )
`)
      .in("box_code", box_codes)
.eq("bin_id", source_bin_id);

    if (error) throw error;

    if (!boxes || boxes.length !== box_codes.length) {
  return NextResponse.json({
    ok: false,
    error: "One or more boxes not found in the selected device.",
  });
}

    let totalGlobal = 0;
    const result = [];

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
        .eq("box_id", box.id)
        .eq("status", "IN");

      const total = count || 0;

      if (total === 0) {
        return NextResponse.json({
          ok: false,
          error: `Box ${box.box_code} is empty.`,
        });
      }

      totalGlobal += total;

      result.push({
        box_code: box.box_code,
        device: (box as any).bins?.name || "Unknown",
        current_floor: box.floor,
        imei_count: total,
      });
    }

    return NextResponse.json({
      ok: true,
      preview: true,
      boxes: result,
      total_boxes: result.length,
      total_items: totalGlobal,
      target_floor,
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}