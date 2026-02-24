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
    const { device_id, min_stock } = await req.json();

    if (!device_id) {
      return NextResponse.json({ ok: false, error: "Missing device_id" });
    }

    await supabase
      .from("devices")
      .update({ min_stock: Number(min_stock) || 0 })
      .eq("device_id", device_id);

    return NextResponse.json({ ok: true });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}