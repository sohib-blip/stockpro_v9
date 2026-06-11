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

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const userEmail = url.searchParams.get("user_email");

    if (!userEmail) {
      return NextResponse.json(
        { ok: false, error: "Missing user_email" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      active: data?.[0] || null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Current NRD failed" },
      { status: 500 }
    );
  }
}