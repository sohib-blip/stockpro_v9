import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApiIdentity, resolveApiUserEmail } from "@/lib/api-identity";

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

function getPeriodMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function POST(req: Request) {
  try {
    const supabase = sb();
    const { user_email: requestedEmail, task } = await req.json();
    const identity = getApiIdentity(req);
    const userEmail = resolveApiUserEmail(req, requestedEmail);

    if (!task) {
      return NextResponse.json(
        { ok: false, error: "Missing task" },
        { status: 400 }
      );
    }

    const { data: active, error: activeErr } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .is("ended_at", null)
      .limit(1);

    if (activeErr) throw activeErr;

    if (active && active.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "You already have an active NRD task running.",
          active: active[0],
        },
        { status: 400 }
      );
    }

    const startedAt = new Date();

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .insert({
        user_id: identity.userId,
        user_email: userEmail,
        task,
        started_at: startedAt.toISOString(),
        period_month: getPeriodMonth(startedAt),
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      row: data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Start NRD failed" },
      { status: 500 }
    );
  }
}
