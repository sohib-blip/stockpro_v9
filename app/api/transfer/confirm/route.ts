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
    const { box_codes, target_floor, actor } = await req.json();

    if (!Array.isArray(box_codes) || box_codes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No box codes provided." },
        { status: 400 }
      );
    }

    if (!target_floor) {
      return NextResponse.json(
        { ok: false, error: "Target floor required." },
        { status: 400 }
      );
    }

    const { data: boxes, error } = await supabase
      .from("boxes")
      .select("id, box_code")
      .in("box_code", box_codes);

    if (error) throw error;

    if (!boxes || boxes.length !== box_codes.length) {
      return NextResponse.json(
        { ok: false, error: "One or more boxes not found." },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from("boxes")
      .update({ floor: target_floor })
      .in("box_code", box_codes);

    if (updateErr) throw updateErr;

    const movements = boxes.map((box) => ({
      type: "TRANSFER",
      box_id: box.id,
      actor: actor || "unknown",
      created_at: new Date().toISOString(),
    }));

    const { error: moveErr } = await supabase
      .from("movements")
      .insert(movements as any);

    if (moveErr) throw moveErr;

    return NextResponse.json({
      ok: true,
      moved_boxes: boxes.length,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Transfer failed." },
      { status: 500 }
    );
  }
}