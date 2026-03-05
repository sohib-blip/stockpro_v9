import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}

export async function GET() {

  const supabase = sb();

  const { data } = await supabase
    .from("movements")
    .select("device,type,created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    ok: true,
    rows: data || []
  });

}