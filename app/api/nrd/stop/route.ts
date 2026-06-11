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

export async function POST(req: Request) {
  try {
    const supabase = sb();
    const { user_email } = await req.json();

    if (!user_email) {
      return NextResponse.json(
        { ok: false, error: "Missing user_email" },
        { status: 400 }
      );
    }

    const { data: active, error: activeErr } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", user_email)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (activeErr) throw activeErr;

    const endedAt = new Date();
    const startedAt = new Date(active.started_at);

    const durationMinutes = Math.max(
      1,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
    );

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .update({
        ended_at: endedAt.toISOString(),
        duration_minutes: durationMinutes,
      })
      .eq("id", active.id)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      row: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Stop NRD failed" },
      { status: 500 }
    );
  }
}