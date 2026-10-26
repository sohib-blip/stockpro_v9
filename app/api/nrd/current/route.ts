import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUserEmail } from "@/lib/api-identity";
import { trySyncNrdForUser } from "@/lib/nrd-sync";
import { nrdAutoStopAt, scheduleOccurrence, type NrdSchedule } from "@/lib/nrd-time";

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

// End of the time slot of a task started by a schedule.
async function scheduledEnd(
  supabase: ReturnType<typeof sb>,
  active: { schedule_id?: string | null; schedule_date?: string | null }
) {
  if (!active.schedule_id || !active.schedule_date) return null;
  const { data } = await supabase
    .from("nrd_schedules")
    .select("id,task,repeat,schedule_date,weekday,start_time,end_time,created_at")
    .eq("id", active.schedule_id)
    .maybeSingle();
  return data
    ? scheduleOccurrence(data as NrdSchedule, active.schedule_date)?.end.toISOString() ?? null
    : null;
}

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const userEmail = resolveApiUserEmail(
      req,
      url.searchParams.get("user_email")
    );

    await trySyncNrdForUser(supabase, userEmail);

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const active = data?.[0] || null;
    return NextResponse.json({
      ok: true,
      active: active
        ? { ...active, scheduled_end: await scheduledEnd(supabase, active) }
        : null,
      // Every task stops at this time today (17:00 Belgian time).
      day_end: nrdAutoStopAt(new Date()).toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Current NRD failed" },
      { status: 500 }
    );
  }
}
