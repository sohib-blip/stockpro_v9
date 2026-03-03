import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const { box_codes, target_floor } = await req.json();

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

    const supabase = createServerClient();

    // 🔐 Get authenticated user
    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated." },
        { status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { ok: false, error: "Invalid user session." },
        { status: 401 }
      );
    }

    // 📦 Load boxes
    const { data: boxes, error } = await supabase
      .from("boxes")
      .select("id, box_code, floor")
      .in("box_code", box_codes);

    if (error) throw error;

    if (!boxes || boxes.length !== box_codes.length) {
      return NextResponse.json(
        { ok: false, error: "One or more boxes not found." },
        { status: 400 }
      );
    }

    // 🚫 Prevent transfer to same floor
    for (const box of boxes) {
      if (box.floor === target_floor) {
        return NextResponse.json(
          {
            ok: false,
            error: `Box ${box.box_code} already on floor ${target_floor}`,
          },
          { status: 400 }
        );
      }
    }

    // 🔄 Update floors
    const { error: updateErr } = await supabase
      .from("boxes")
      .update({ floor: target_floor })
      .in("box_code", box_codes);

    if (updateErr) throw updateErr;

    // 📝 Log movements
    const movements = boxes.map((box) => ({
      type: "TRANSFER",
      box_id: box.id,
      created_by: user.id,        // ✅ proper user id
      actor: user.email,          // ✅ readable email
      created_at: new Date().toISOString(),
    }));

    const { error: moveErr } = await supabase
      .from("movements")
      .insert(movements);

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