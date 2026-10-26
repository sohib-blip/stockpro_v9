import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { trySyncNrdForUser } from "@/lib/nrd-sync";
import { brusselsDate, NRD_DAY_END } from "@/lib/nrd-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const scheduleSchema = z
  .object({
    task: z.string().trim().min(1).max(120),
    repeat: z.enum(["once", "weekly"]),
    schedule_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    weekday: z.coerce.number().int().min(1).max(7).optional().nullable(),
    start_time: time,
    end_time: time,
  })
  .superRefine((value, context) => {
    if (value.end_time <= value.start_time) {
      context.addIssue({ code: "custom", message: "The end time must be after the start time." });
    }
    if (value.end_time > NRD_DAY_END) {
      context.addIssue({ code: "custom", message: "NRD tasks stop at 17:00: a schedule must end by 17:00." });
    }
    if (value.repeat === "once" && !value.schedule_date) {
      context.addIssue({ code: "custom", message: "Choose the date of the scheduled task." });
    }
    if (value.repeat === "weekly" && !value.weekday) {
      context.addIssue({ code: "custom", message: "Choose the day of the week." });
    }
  });

const SCHEDULE_COLUMNS = "id,task,repeat,schedule_date,weekday,start_time,end_time,created_at";

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Each user lists and manages only their own scheduled NRD tasks.
export async function GET(req: Request) {
  try {
    const { email } = getApiIdentity(req);
    const { data, error } = await sb()
      .from("nrd_schedules")
      .select(SCHEDULE_COLUMNS)
      .eq("user_email", email)
      .order("repeat", { ascending: true })
      .order("schedule_date", { ascending: true })
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (error) {
    console.error("NRD SCHEDULES LIST ERROR", error);
    return failure("Scheduled tasks could not be loaded", 500);
  }
}

export async function POST(req: Request) {
  try {
    const parsed = scheduleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues.find((item) => item.code === "custom");
      return failure(issue?.message || "Invalid scheduled task", 400);
    }
    const value = parsed.data;
    if (value.repeat === "once" && value.schedule_date! < brusselsDate(new Date())) {
      return failure("The date of the scheduled task is in the past.", 400);
    }

    const identity = getApiIdentity(req);
    const supabase = sb();
    const { data, error } = await supabase
      .from("nrd_schedules")
      .insert({
        user_id: identity.userId,
        user_email: identity.email,
        task: value.task,
        repeat: value.repeat,
        schedule_date: value.repeat === "once" ? value.schedule_date : null,
        weekday: value.repeat === "weekly" ? value.weekday : null,
        start_time: value.start_time,
        end_time: value.end_time,
      })
      .select(SCHEDULE_COLUMNS)
      .single();
    if (error) throw error;

    // A slot that is already running today starts right away.
    await trySyncNrdForUser(supabase, identity.email);
    return NextResponse.json({ ok: true, row: data }, { status: 201 });
  } catch (error) {
    console.error("NRD SCHEDULE CREATE ERROR", error);
    return failure("Scheduled task could not be saved", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failure("Invalid scheduled task", 400);

    const { email } = getApiIdentity(req);
    const supabase = sb();
    const { data: schedule, error: scheduleError } = await supabase
      .from("nrd_schedules")
      .select("id")
      .eq("id", parsed.data.id)
      .eq("user_email", email)
      .maybeSingle();
    if (scheduleError) throw scheduleError;
    if (!schedule) return failure("Scheduled task not found", 404);

    // A task of this schedule that is running now stops at once.
    const now = new Date();
    const { data: running, error: runningError } = await supabase
      .from("nrd_time_logs")
      .select("id,started_at")
      .eq("schedule_id", schedule.id)
      .is("ended_at", null);
    if (runningError) throw runningError;
    for (const log of running || []) {
      const minutes = Math.max(
        1,
        Math.round((now.getTime() - new Date(log.started_at).getTime()) / 60_000)
      );
      const { error } = await supabase
        .from("nrd_time_logs")
        .update({ ended_at: now.toISOString(), duration_minutes: minutes })
        .eq("id", log.id)
        .is("ended_at", null);
      if (error) throw error;
    }

    const { error } = await supabase.from("nrd_schedules").delete().eq("id", schedule.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NRD SCHEDULE DELETE ERROR", error);
    return failure("Scheduled task could not be deleted", 500);
  }
}
