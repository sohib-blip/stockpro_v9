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
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");

  const { data: templates, error } = await supabase
    .from("device_accessory_templates")
    .select("*")
    .eq("device_id", deviceId);

  return NextResponse.json({
    ok: !error,
    deviceId,
    error: error?.message || null,
    templates: templates || [],
  });
}