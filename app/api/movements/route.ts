import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data } = await supabase
    .from("movements")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ rows: data });
}