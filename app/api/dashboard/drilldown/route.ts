import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const device_id = searchParams.get("device_id");

  if (!device_id) {
    return NextResponse.json({ ok: false, error: "Missing device_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dashboard_drilldown_view")
    .select("*")
    .eq("device_id", device_id)
    .order("box_code");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}