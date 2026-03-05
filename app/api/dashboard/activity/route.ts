import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

  const { data } = await supabase
    .from("movements")
    .select(`
      type,
      created_at,
      bins (
        device
      )
    `)
    .order("created_at", { ascending: false })
    .limit(20);

  const rows = (data || []).map((m:any)=>({
    type: m.type,
    device: m.bins?.device || "Unknown",
    created_at: m.created_at
  }));

  return NextResponse.json({
    ok: true,
    rows
  });

}