import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();

  const { name, stock, minimum_stock, accessory_bin_id } = body;

  const { error } = await supabase.from("accessories").insert({
    name,
    current_stock: Number(stock || 0),
    minimum_stock: Number(minimum_stock || 0),
    accessory_bin_id: accessory_bin_id || null,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}