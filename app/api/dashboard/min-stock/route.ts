import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const { device_id, min_stock } = await req.json();

  const { data, error } = await supabase
    .from("bins")
    .update({ min_stock: Number(min_stock) })
    .eq("id", device_id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return NextResponse.json({ ok:false, error:error.message });
  }

  return NextResponse.json({
    ok:true,
    row:data
  });
}