// NRD working-day rules in Belgian time: every task stops at 17:00
// (Europe/Brussels, summer and winter time), and scheduled tasks start and
// stop at fixed local times.

export const NRD_TIME_ZONE = "Europe/Brussels";
export const NRD_DAY_END = "17:00";

export type NrdSchedule = {
  id: string;
  task: string;
  repeat: "once" | "weekly";
  schedule_date: string | null;
  weekday: number | null;
  start_time: string;
  end_time: string;
  created_at: string;
};

function zonedParts(date: Date, timeZone = NRD_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

// Minutes the zone is ahead of UTC at this instant (+60 in winter, +120 in summer).
function zoneOffsetMinutes(date: Date, timeZone = NRD_TIME_ZONE) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-10-27" in Belgian time. */
export function brusselsDate(date: Date) {
  const p = zonedParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** ISO weekday in Belgian time: 1 = Monday ... 7 = Sunday. */
export function brusselsWeekday(date: Date) {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(zonedParts(date).weekday) + 1;
}

/** The instant of a Belgian date and time ("2026-10-27", "17:00"). */
export function brusselsInstant(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - zoneOffsetMinutes(new Date(guess)) * 60_000;
  const corrected = guess - zoneOffsetMinutes(new Date(instant)) * 60_000;
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

/** 17:00 Belgian time on the day the task started. */
export function nrdAutoStopAt(startedAt: Date) {
  return brusselsInstant(brusselsDate(startedAt), NRD_DAY_END);
}

/** True from 17:00 Belgian time: no NRD task may run any more that day. */
export function isAfterNrdDayEnd(now: Date) {
  return now.getTime() >= nrdAutoStopAt(now).getTime();
}

/** Start and end of a schedule on a Belgian date, or null when it does not run that day. */
export function scheduleOccurrence(schedule: NrdSchedule, date: string) {
  if (schedule.repeat === "once" && schedule.schedule_date !== date) return null;
  if (schedule.repeat === "weekly") {
    const weekday = brusselsWeekday(brusselsInstant(date, "12:00"));
    if (schedule.weekday !== weekday) return null;
  }
  return {
    start: brusselsInstant(date, schedule.start_time.slice(0, 5)),
    end: brusselsInstant(date, schedule.end_time.slice(0, 5)),
  };
}
