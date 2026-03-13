import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const { device_id, min_stock } = await req.json();

  // récupérer le nom du device depuis la view
  const { data: device } = await supabase
    .from("dashboard_bins_view")
    .select("device")
    .eq("device_id", device_id)
    .single();

  if (!device) {
    return NextResponse.json({ ok:false, error:"Device not found" });
  }

  // update dans la vraie table bins
  const { error } = await supabase
    .from("bins")
    .update({ min_stock:Number(min_stock) })
    .eq("name", device.device);

  if (error) {
    return NextResponse.json({ ok:false, error:error.message });
  }

  return NextResponse.json({ ok:true });
}