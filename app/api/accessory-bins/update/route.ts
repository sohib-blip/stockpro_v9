import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const {
  id,
  name,
  current_stock,
  minimum_stock,
  category,
} = await req.json();

    if (!id) {
      return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("accessory_bins")
      .update({
  name: name.trim(),
  current_stock: Number(current_stock || 0),
  minimum_stock: Number(minimum_stock || 0),
  category,
})
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Update failed" },
      { status: 500 }
    );
  }
}