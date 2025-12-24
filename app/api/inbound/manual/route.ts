import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { device, box_no, master_box_no, imeis } = body;

    if (!device || !box_no || !Array.isArray(imeis) || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 🔒 Check duplicates already in DB
    const { data: existing } = await supabase
      .from("items")
      .select("imei")
      .in("imei", imeis);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Duplicate IMEI found",
          duplicates: existing.map((e: any) => e.imei),
        },
        { status: 409 }
      );
    }

    // 🧱 Insert items
    const rows = imeis.map((imei: string) => ({
      imei,
      device,
      box_no,
      master_box_no: master_box_no ?? null,
      status: "IN",
    }));

    const { error } = await supabase.from("items").insert(rows);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
