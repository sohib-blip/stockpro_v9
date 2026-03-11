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

    const body = await req.json();
    const { box_codes, target_floor } = body;

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

    const authHeader = req.headers.get("authorization");

    if (!authHeader) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
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
        { ok: false, error: "Invalid session." },
        { status: 401 }
      );
    }

    // ================= LOAD BOXES =================

    const { data: boxes, error: loadError } = await supabase
      .from("boxes")
      .select(`
        id,
        box_code,
        floor,
        bins (
          device_id
        )
      `)
      .in("box_code", box_codes);

    if (loadError) throw loadError;

    if (!boxes || boxes.length !== box_codes.length) {
      return NextResponse.json(
        { ok: false, error: "One or more boxes not found." },
        { status: 400 }
      );
    }

    // ================= UPDATE FLOOR =================

    const { error: updateErr } = await supabase
      .from("boxes")
      .update({ floor: target_floor })
      .in("box_code", box_codes);

    if (updateErr) throw updateErr;

    // ================= CREATE MOVEMENTS =================

    const movements = boxes.map((box: any) => {

      const device_id = box?.bins?.device_id;

      if (!device_id) {
        throw new Error(`Device not found for box ${box.box_code}`);
      }

      return {
        type: "TRANSFER",
        device_id: device_id,
        box_id: box.id,
        actor: user.email,
        created_by: user.id,
        from_floor: box.floor,
        to_floor: target_floor,
        created_at: new Date().toISOString(),
      };

    });

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