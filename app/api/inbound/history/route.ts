import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = sb();

    const { data, error } = await supabase
      .from("inbound_history_view")
      .select("*")
      .limit(200);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: data || [],
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}