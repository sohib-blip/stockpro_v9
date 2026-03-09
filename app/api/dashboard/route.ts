import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {

  // total stock
  const { count } = await supabase
    .from("items")
    .select("*", { count: "exact", head: true })
    .eq("status", "IN");

  // stock par device
  const { data: devices } = await supabase
    .from("dashboard_devices")
    .select("*")
    .order("device");

  return NextResponse.json({
    total_stock: count ?? 0,
    devices: devices ?? []
  });

}