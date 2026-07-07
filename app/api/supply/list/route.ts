import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
  .from("supplies")
  .select("*")
  .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: data || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Supply list failed" },
      { status: 500 }
    );
  }
}