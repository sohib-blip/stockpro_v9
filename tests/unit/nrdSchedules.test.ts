import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForApi } from "../../lib/access-control";
import { translateUiText } from "../../lib/i18n";
import { syncNrdForEveryone, syncNrdForUser } from "../../lib/nrd-sync";
import {
  brusselsDate,
  brusselsInstant,
  brusselsWeekday,
  isAfterNrdDayEnd,
  nrdAutoStopAt,
  scheduleOccurrence,
  type NrdSchedule,
} from "../../lib/nrd-time";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261027090000_add_nrd_schedules_and_auto_stop.sql"),
  "utf8"
).toLowerCase();
const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));

// Minimal in-memory stand-in for the Supabase query builder used by nrd-sync.
function fakeSupabase(tables: Record<string, Array<Record<string, any>>>) {
  function builder(table: string) {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    let action: "select" | "update" | "insert" = "select";
    let payload: Record<string, any> = {};
    let order: { column: string; ascending: boolean } | null = null;
    let limit: number | null = null;
    const api: any = {
      select: () => api,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), api),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), api),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), api),
      order: (column: string, options: { ascending: boolean }) => ((order = { column, ascending: options.ascending }), api),
      limit: (value: number) => ((limit = value), api),
      update: (value: Record<string, any>) => ((action = "update"), (payload = value), api),
      insert: (value: Record<string, any>) => ((action = "insert"), (payload = value), api),
      then(resolve: (value: unknown) => void) {
        const rows = tables[table];
        if (action === "insert") {
          rows.push({ id: `log-${rows.length + 1}`, ended_at: null, auto_stopped: false, ...payload });
          return resolve({ data: null, error: null });
        }
        let matched = rows.filter((row) => filters.every((filter) => filter(row)));
        if (action === "update") {
          matched.forEach((row) => Object.assign(row, payload));
          return resolve({ data: null, error: null });
        }
        if (order) {
          const { column, ascending } = order;
          matched = [...matched].sort((a, b) => (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1));
        }
        if (limit !== null) matched = matched.slice(0, limit);
        return resolve({ data: matched.map((row) => ({ ...row })), error: null });
      },
    };
    return api;
  }
  return { from: builder } as any;
}

function schedule(overrides: Partial<NrdSchedule & { user_email: string; user_id: string }>) {
  return {
    id: "schedule-1",
    user_id: "user-1",
    user_email: "a@stockpro.test",
    task: "Team Meeting",
    repeat: "once" as const,
    schedule_date: "2026-10-27",
    weekday: null,
    start_time: "09:00:00",
    end_time: "09:30:00",
    created_at: "2026-10-20T08:00:00.000Z",
    ...overrides,
  };
}

describe("NRD Belgian time", () => {
  it("converts Belgian times in winter and summer", () => {
    expect(brusselsInstant("2026-10-27", "17:00").toISOString()).toBe("2026-10-27T16:00:00.000Z");
    expect(brusselsInstant("2026-07-15", "17:00").toISOString()).toBe("2026-07-15T15:00:00.000Z");
    // Days when the clocks change.
    expect(brusselsInstant("2026-10-25", "17:00").toISOString()).toBe("2026-10-25T16:00:00.000Z");
    expect(brusselsInstant("2026-03-29", "17:00").toISOString()).toBe("2026-03-29T15:00:00.000Z");
  });

  it("stops every task at 17:00 on the Belgian day it started", () => {
    expect(nrdAutoStopAt(new Date("2026-10-27T07:30:00Z")).toISOString()).toBe("2026-10-27T16:00:00.000Z");
    // 00:30 on 28 October in Brussels.
    expect(nrdAutoStopAt(new Date("2026-10-27T23:30:00Z")).toISOString()).toBe("2026-10-28T16:00:00.000Z");
    expect(isAfterNrdDayEnd(new Date("2026-10-27T15:59:00Z"))).toBe(false);
    expect(isAfterNrdDayEnd(new Date("2026-10-27T16:00:00Z"))).toBe(true);
    expect(brusselsDate(new Date("2026-10-27T23:30:00Z"))).toBe("2026-10-28");
    expect(brusselsWeekday(new Date("2026-10-26T12:00:00Z"))).toBe(1);
  });

  it("finds when a schedule runs", () => {
    const weekly = schedule({ repeat: "weekly", schedule_date: null, weekday: 2 });
    expect(scheduleOccurrence(weekly, "2026-10-27")?.start.toISOString()).toBe("2026-10-27T08:00:00.000Z");
    expect(scheduleOccurrence(weekly, "2026-10-28")).toBeNull();
    expect(scheduleOccurrence(schedule({}), "2026-10-28")).toBeNull();
    expect(scheduleOccurrence(schedule({}), "2026-10-27")?.end.toISOString()).toBe("2026-10-27T08:30:00.000Z");
  });
});

describe("NRD upkeep", () => {
  it("ends a forgotten task at exactly 17:00 Belgian time", async () => {
    const tables = {
      nrd_time_logs: [
        { id: "a", user_id: "user-1", user_email: "a@stockpro.test", task: "Returns", started_at: "2026-10-26T07:00:00.000Z", ended_at: null, schedule_id: null, schedule_date: null },
      ],
      nrd_schedules: [],
    };
    await syncNrdForUser(fakeSupabase(tables), "a@stockpro.test", new Date("2026-10-27T08:00:00Z"));
    expect(tables.nrd_time_logs[0]).toMatchObject({
      ended_at: "2026-10-26T16:00:00.000Z",
      duration_minutes: 540,
      auto_stopped: true,
    });
  });

  it("starts a scheduled task on time and stops it at its end", async () => {
    const tables: Record<string, any[]> = {
      nrd_time_logs: [
        { id: "a", user_id: "user-1", user_email: "a@stockpro.test", task: "Returns", started_at: "2026-10-27T07:00:00.000Z", ended_at: null, schedule_id: null, schedule_date: null },
      ],
      nrd_schedules: [schedule({})],
    };
    const supabase = fakeSupabase(tables);

    await syncNrdForUser(supabase, "a@stockpro.test", new Date("2026-10-27T08:10:00Z"));
    expect(tables.nrd_time_logs[0]).toMatchObject({ ended_at: "2026-10-27T08:00:00.000Z", duration_minutes: 60, auto_stopped: false });
    expect(tables.nrd_time_logs[1]).toMatchObject({
      task: "Team Meeting",
      started_at: "2026-10-27T08:00:00.000Z",
      ended_at: null,
      schedule_id: "schedule-1",
      schedule_date: "2026-10-27",
    });

    // Running again does not start the meeting twice.
    await syncNrdForUser(supabase, "a@stockpro.test", new Date("2026-10-27T08:20:00Z"));
    expect(tables.nrd_time_logs).toHaveLength(2);

    // After 09:30 the meeting stops; nothing else starts.
    await syncNrdForUser(supabase, "a@stockpro.test", new Date("2026-10-27T08:45:00Z"));
    expect(tables.nrd_time_logs[1]).toMatchObject({ ended_at: "2026-10-27T08:30:00.000Z", duration_minutes: 30, auto_stopped: false });
    expect(tables.nrd_time_logs.filter((row) => !row.ended_at)).toHaveLength(0);
  });

  it("lets a missed slot stop the running task instead of the 17:00 rule", async () => {
    const tables: Record<string, any[]> = {
      nrd_time_logs: [
        { id: "a", user_id: "user-1", user_email: "a@stockpro.test", task: "Returns", started_at: "2026-10-27T06:00:00.000Z", ended_at: null, schedule_id: null, schedule_date: null },
      ],
      nrd_schedules: [schedule({})],
    };
    // Nobody opened StockPro during the day: only the evening upkeep runs.
    await syncNrdForEveryone(fakeSupabase(tables), new Date("2026-10-27T16:05:00Z"));
    expect(tables.nrd_time_logs[0]).toMatchObject({ ended_at: "2026-10-27T08:00:00.000Z", duration_minutes: 120, auto_stopped: false });
    expect(tables.nrd_time_logs[1]).toMatchObject({ task: "Team Meeting", started_at: "2026-10-27T08:00:00.000Z", ended_at: "2026-10-27T08:30:00.000Z" });
    expect(tables.nrd_time_logs).toHaveLength(2);
  });

  it("runs back-to-back slots in order", async () => {
    const tables: Record<string, any[]> = {
      nrd_time_logs: [
        { id: "a", user_id: "user-1", user_email: "a@stockpro.test", task: "Returns", started_at: "2026-10-27T06:00:00.000Z", ended_at: null, schedule_id: null, schedule_date: null },
      ],
      nrd_schedules: [
        schedule({ id: "schedule-2", task: "Training", start_time: "09:30:00", end_time: "10:00:00" }),
        schedule({}),
      ],
    };
    await syncNrdForUser(fakeSupabase(tables), "a@stockpro.test", new Date("2026-10-27T08:45:00Z"));
    expect(tables.nrd_time_logs.map((row) => [row.task, row.started_at, row.ended_at])).toEqual([
      ["Returns", "2026-10-27T06:00:00.000Z", "2026-10-27T08:00:00.000Z"],
      ["Team Meeting", "2026-10-27T08:00:00.000Z", "2026-10-27T08:30:00.000Z"],
      ["Training", "2026-10-27T08:30:00.000Z", null],
    ]);
  });

  it("records a scheduled task even when nobody opened StockPro", async () => {
    const tables: Record<string, any[]> = {
      nrd_time_logs: [],
      nrd_schedules: [schedule({ repeat: "weekly", schedule_date: null, weekday: 2 })],
    };
    await syncNrdForEveryone(fakeSupabase(tables), new Date("2026-10-27T16:05:00Z"));
    expect(tables.nrd_time_logs).toEqual([
      expect.objectContaining({
        task: "Team Meeting",
        started_at: "2026-10-27T08:00:00.000Z",
        ended_at: "2026-10-27T08:30:00.000Z",
        duration_minutes: 30,
      }),
    ]);
  });

  it("keeps schedules and the daily upkeep behind the right boundaries", () => {
    expect(migration.trimStart()).toMatch(/^begin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("create table if not exists public.nrd_schedules");
    expect(migration).toContain("end_time > start_time and end_time <= time '17:00'");
    expect(migration).toContain("alter table public.nrd_schedules enable row level security");
    expect(migration).toContain("add column if not exists auto_stopped boolean not null default false");
    expect(permissionsForApi("/api/nrd/schedules", "POST")).toEqual(["can_nrd"]);
    expect(permissionsForApi("/api/cron/nrd", "GET")).toBeNull();
    expect(vercel.crons).toContainEqual({ path: "/api/cron/nrd", schedule: "5 16 * * *" });
  });

  it("translates the new texts", () => {
    expect(translateUiText("fr", "Scheduled tasks")).toBe("Tâches programmées");
    expect(translateUiText("fr", "Every Monday")).toBe("Chaque lundi");
    expect(translateUiText("nl", "Scheduled · stops at 09:30")).toBe("Gepland · stopt om 09:30");
  });
});
