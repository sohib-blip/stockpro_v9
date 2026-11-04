import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUserEmail } from "@/lib/api-identity";
import { syncNrdForReader } from "@/lib/nrd-sync";
import {
  nrdAutoStopAt,
  nrdTaskStopsAt,
  scheduleOccurrence,
  type NrdSchedule,
} from "@/lib/nrd-time";

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

    const now = new Date();
    const synced = await syncNrdForReader(supabase, userEmail, now);

    async function readActive() {
      const { data, error } = await supabase
        .from("nrd_time_logs")
        .select("*")
        .eq("user_email", userEmail)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = data?.[0] || null;
      return row ? { ...row, scheduled_end: await scheduledEnd(supabase, row) } : null;
    }

    let active = await readActive();
    // The last sync is less than a minute old but this task has reached
    // 17:00 or the end of its slot: stop it now rather than at the next sync.
    if (
      !synced &&
      active &&
      now.getTime() >=
        nrdTaskStopsAt(
          new Date(active.started_at),
          active.scheduled_end ? new Date(active.scheduled_end) : null
        ).at.getTime()
    ) {
      await syncNrdForReader(supabase, userEmail, now, { force: true });
      active = await readActive();
    }

    return NextResponse.json({
      ok: true,
      active,
      // Every task stops at this time today (17:00 Belgian time).
      day_end: nrdAutoStopAt(now).toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Current NRD failed" },
      { status: 500 }
    );
  }
}
