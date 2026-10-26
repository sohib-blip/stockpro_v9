import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronRequestAuthorized } from "@/lib/cron/lowStockPolicy";
import { syncNrdForEveryone } from "@/lib/nrd-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Daily after 17:00 Belgian time: stops every forgotten NRD task at 17:00 and
// records the scheduled tasks of the day, even when nobody opened StockPro.
export async function GET(req: Request) {
  if (!isCronRequestAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    await syncNrdForEveryone(supabase);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NRD CRON ERROR", error);
    return NextResponse.json({ ok: false, error: "NRD upkeep failed" }, { status: 500 });
  }
}
