import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mergeDashboardBinRows } from "@/lib/dashboard-bin-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
 const [
  { data: activeBins, error: binsError },
  { data: stockRows, error: stockError },
 ] = await Promise.all([
  supabase
   .from("bins")
   .select("id,name,min_stock")
   .eq("active", true)
   .order("name"),
  supabase.from("dashboard_bins_view").select("*"),
 ]);

 const error = binsError || stockError;
 if (error) {
  return NextResponse.json({ ok:false, error:error.message }, { status:500 });
 }

 return NextResponse.json({
  ok:true,
  rows:mergeDashboardBinRows(activeBins ?? [], stockRows ?? [])
 });
}
