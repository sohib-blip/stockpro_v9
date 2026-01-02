import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { box_id } = body;

    if (!box_id) {
      return NextResponse.json(
        { ok: false, error: "Missing box_id" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1️⃣ Récupérer la box
    const { data: box, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, device, box_no")
      .eq("box_id", box_id)
      .single();

    if (boxErr || !box) {
      return NextResponse.json(
        { ok: false, error: "Box not found" },
        { status: 404 }
      );
    }

    // 2️⃣ Récupérer les IMEIs encore IN STOCK
    const { data: items, error: itemErr } = await supabase
      .from("items")
      .select("imei")
      .eq("box_id", box_id)
      .is("outbound_at", null); // ⬅️ important

    if (itemErr) {
      return NextResponse.json(
        { ok: false, error: itemErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      box: {
        box_id: box.box_id,
        device: box.device,
        box_no: box.box_no,
      },
      imeis: (items || []).map((i) => i.imei),
      count: items?.length || 0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
