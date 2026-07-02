import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { name, current_stock, minimum_stock } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Accessory name is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("accessory_bins").insert({
      name: name.trim(),
      current_stock: Number(current_stock || 0),
      minimum_stock: Number(minimum_stock || 0),
      active: true,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Create accessory failed" },
      { status: 500 }
    );
  }
}