import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const { box_code, target_floor, confirm, actor } = await req.json();

    if (!box_code) {
      return NextResponse.json(
        { ok: false, error: "Box code required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // 1️⃣ Load box
    const { data: box, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, box_code, floor")
      .eq("box_code", box_code)
      .single();

    if (boxErr || !box) {
      return NextResponse.json(
        { ok: false, error: "Box not found" },
        { status: 404 }
      );
    }

    // 2️⃣ Count items IN
    const { count } = await supabase
      .from("items")
      .select("*", { count: "exact", head: true })
      .eq("box_id", box.box_id)
      .eq("status", "IN");

    // PREVIEW MODE
    if (!confirm) {
      return NextResponse.json({
        ok: true,
        preview: true,
        box_code: box.box_code,
        current_floor: box.floor,
        target_floor,
        total_items: count ?? 0,
      });
    }

    // CONFIRM MODE
    if (!target_floor) {
      return NextResponse.json(
        { ok: false, error: "Target floor required" },
        { status: 400 }
      );
    }

    if (box.floor === target_floor) {
      return NextResponse.json(
        { ok: false, error: "Box already on that floor" },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from("boxes")
      .update({ floor: target_floor })
      .eq("box_id", box.box_id);

    if (updateErr) throw updateErr;

    // 🔥 Optional: log movement
    await supabase.from("movements").insert({
      type: "TRANSFER",
      box_id: box.box_id,
      actor: actor || "unknown",
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      moved_box: box.box_code,
      moved_items: count ?? 0,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Transfer failed" },
      { status: 500 }
    );
  }
}