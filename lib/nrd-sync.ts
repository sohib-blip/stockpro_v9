import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brusselsDate,
  brusselsInstant,
  nrdAutoStopAt,
  scheduleOccurrence,
  type NrdSchedule,
} from "./nrd-time";

// Server-side NRD upkeep, run before NRD data is read or changed and by the
// daily cron: stop forgotten tasks at 17:00 Belgian time and start/stop
// scheduled tasks at their planned times. Every step is idempotent.

type Client = SupabaseClient<any, any, any>;

type NrdLog = {
  id: string;
  user_id: string | null;
  user_email: string;
  task: string;
  started_at: string;
  schedule_id: string | null;
  schedule_date: string | null;
};

const LOG_COLUMNS = "id,user_id,user_email,task,started_at,schedule_id,schedule_date";

function minutesBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

// Same reporting month as the start route.
function periodMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function closeLog(supabase: Client, log: NrdLog, endedAt: Date, autoStopped: boolean) {
  const started = new Date(log.started_at);
  const end = endedAt.getTime() < started.getTime() ? started : endedAt;
  const { error } = await supabase
    .from("nrd_time_logs")
    .update({
      ended_at: end.toISOString(),
      duration_minutes: minutesBetween(started, end),
      auto_stopped: autoStopped,
    })
    .eq("id", log.id)
    .is("ended_at", null);
  if (error) throw error;
}

async function loadSchedules(supabase: Client, filter: { userEmail?: string; ids?: string[] }) {
  let query = supabase
    .from("nrd_schedules")
    .select("id,user_id,user_email,task,repeat,schedule_date,weekday,start_time,end_time,created_at");
  if (filter.userEmail) query = query.eq("user_email", filter.userEmail);
  if (filter.ids) query = query.in("id", filter.ids);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as Array<NrdSchedule & { user_id: string | null; user_email: string }>;
}

/** Stop active tasks that reached 17:00 Belgian time or the end of their schedule. */
export async function closeExpiredNrdLogs(supabase: Client, now: Date, userEmail?: string) {
  let query = supabase.from("nrd_time_logs").select(LOG_COLUMNS).is("ended_at", null);
  if (userEmail) query = query.eq("user_email", userEmail);
  const { data, error } = await query;
  if (error) throw error;
  const logs = (data || []) as NrdLog[];
  if (logs.length === 0) return;

  const scheduleIds = Array.from(
    new Set(logs.map((log) => log.schedule_id).filter((id): id is string => Boolean(id)))
  );
  const schedules = new Map(
    (scheduleIds.length ? await loadSchedules(supabase, { ids: scheduleIds }) : []).map(
      (schedule) => [schedule.id, schedule]
    )
  );

  for (const log of logs) {
    const dayEnd = nrdAutoStopAt(new Date(log.started_at));
    const schedule = log.schedule_id ? schedules.get(log.schedule_id) : undefined;
    const scheduledEnd =
      schedule && log.schedule_date ? scheduleOccurrence(schedule, log.schedule_date)?.end : undefined;
    const endsWithSchedule = Boolean(scheduledEnd && scheduledEnd.getTime() < dayEnd.getTime());
    const limit = endsWithSchedule ? scheduledEnd! : dayEnd;
    if (now.getTime() >= limit.getTime()) {
      await closeLog(supabase, log, limit, !endsWithSchedule);
    }
  }
}

/** Start (and, once over, stop) the user's scheduled tasks of a Belgian day. */
export async function applyNrdSchedules(
  supabase: Client,
  userEmail: string,
  now: Date,
  date = brusselsDate(now)
) {
  // Earliest slot first, so back-to-back slots each stop the task before them.
  const due = (await loadSchedules(supabase, { userEmail }))
    .flatMap((schedule) => {
      const occurrence = scheduleOccurrence(schedule, date);
      return occurrence && now.getTime() >= occurrence.start.getTime() ? [{ schedule, occurrence }] : [];
    })
    .sort((a, b) => a.occurrence.start.getTime() - b.occurrence.start.getTime());
  for (const { schedule, occurrence } of due) {
    const { data: existing, error: existingError } = await supabase
      .from("nrd_time_logs")
      .select("id")
      .eq("schedule_id", schedule.id)
      .eq("schedule_date", date)
      .limit(1);
    if (existingError) throw existingError;
    if (existing?.length) continue;

    const { data: activeRows, error: activeError } = await supabase
      .from("nrd_time_logs")
      .select(LOG_COLUMNS)
      .eq("user_email", userEmail)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (activeError) throw activeError;
    const active = (activeRows?.[0] ?? null) as NrdLog | null;

    // A schedule created during its own time slot starts when it was created.
    let start = occurrence.start;
    const createdAt = new Date(schedule.created_at);
    if (createdAt.getTime() > start.getTime()) start = createdAt;
    if (active && new Date(active.started_at).getTime() > start.getTime()) {
      start = new Date(active.started_at);
    }
    if (start.getTime() >= occurrence.end.getTime()) continue;

    if (active) await closeLog(supabase, active, start, false);

    const finished = now.getTime() >= occurrence.end.getTime();
    const { error: insertError } = await supabase.from("nrd_time_logs").insert({
      user_id: schedule.user_id,
      user_email: userEmail,
      task: schedule.task,
      started_at: start.toISOString(),
      period_month: periodMonth(start),
      schedule_id: schedule.id,
      schedule_date: date,
      ended_at: finished ? occurrence.end.toISOString() : null,
      duration_minutes: finished ? minutesBetween(start, occurrence.end) : null,
    });
    // Another request created this occurrence at the same moment.
    if (insertError && insertError.code !== "23505") throw insertError;
  }
}

// Tasks of earlier days are stopped first; today's tasks only after today's
// slots are applied, so a slot that was missed (nobody had StockPro open)
// still stops the task it interrupted instead of the 17:00 rule.
function startOfBrusselsDay(now: Date) {
  return brusselsInstant(brusselsDate(now), "00:00");
}

/** Bring one user's NRD up to date before reading or changing it. */
export async function syncNrdForUser(supabase: Client, userEmail: string, now = new Date()) {
  await closeExpiredNrdLogs(supabase, startOfBrusselsDay(now), userEmail);
  await applyNrdSchedules(supabase, userEmail, now);
  await closeExpiredNrdLogs(supabase, now, userEmail);
}

/** Daily upkeep for everybody (cron and global exports). */
export async function syncNrdForEveryone(supabase: Client, now = new Date()) {
  await closeExpiredNrdLogs(supabase, startOfBrusselsDay(now));
  const users = new Set((await loadSchedules(supabase, {})).map((schedule) => schedule.user_email));
  for (const userEmail of users) await applyNrdSchedules(supabase, userEmail, now);
  await closeExpiredNrdLogs(supabase, now);
}

/** Same as syncNrdForUser, but a failure never blocks NRD itself. */
export async function trySyncNrdForUser(supabase: Client, userEmail: string, now = new Date()) {
  try {
    await syncNrdForUser(supabase, userEmail, now);
  } catch (error) {
    console.error("NRD SYNC FAILED", error);
  }
}

/** Same as syncNrdForEveryone, but a failure never blocks NRD itself. */
export async function trySyncNrdForEveryone(supabase: Client, now = new Date()) {
  try {
    await syncNrdForEveryone(supabase, now);
  } catch (error) {
    console.error("NRD SYNC FAILED", error);
  }
}
