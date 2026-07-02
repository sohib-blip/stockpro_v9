import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const [{ data: bins, error: binsError }, { data: accessories, error: accError }, { data: rules, error: rulesError }] =
    await Promise.all([
      supabase.from("bins").select("id, name").order("name"),
      supabase.from("accessories").select("*").eq("active", true).order("name"),
      supabase
        .from("accessory_device_rules")
        .select(`
          id,
          device_id,
          accessory_id,
          calculation_type,
          qty,
          devices_per_qty,
          active,
          accessories (
            id,
            name
          )
        `)
        .eq("active", true),
    ]);

  if (binsError || accError || rulesError) {
    return NextResponse.json(
      { ok: false, error: binsError?.message || accError?.message || rulesError?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    bins: bins || [],
    accessories: accessories || [],
    rules: rules || [],
  });
}