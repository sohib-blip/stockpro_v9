"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

type Schedule = {
  id: string;
  task: string;
  repeat: "once" | "weekly";
  schedule_date: string | null;
  weekday: number | null;
  start_time: string;
  end_time: string;
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function errorMessage(body: unknown, fallback: string) {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(`${date}T12:00:00`));
}

// Scheduled NRD tasks of the signed-in user: they start and stop by
// themselves at the planned times (Belgian time), once or every week.
export default function NrdSchedulesPanel({
  tasks,
  onChanged,
  onError,
}: {
  tasks: string[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState(tasks.includes("Team Meeting") ? "Team Meeting" : tasks[0]);
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");

  const load = useCallback(async () => {
    const response = await apiFetch(`/api/nrd/schedules?t=${Date.now()}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setRows(body.rows || []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const response = await apiFetch("/api/nrd/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          repeat,
          schedule_date: repeat === "once" ? date : null,
          weekday: repeat === "weekly" ? Number(weekday) : null,
          start_time: startTime,
          end_time: endTime,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(errorMessage(body, "Scheduled task could not be saved"));
      await load();
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Scheduled task could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Schedule) {
    setBusy(true);
    try {
      const response = await apiFetch("/api/nrd/schedules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(errorMessage(body, "Scheduled task could not be deleted"));
      await load();
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Scheduled task could not be deleted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="prototype-card nrd-schedules-card">
      <div className="nrd-schedules-heading">
        <div>
          <h2>Scheduled tasks</h2>
          <p>Start and stop a task by itself at fixed times (Belgian time), for example a team meeting. Tasks always stop at 17:00.</p>
        </div>
      </div>

      <div className="nrd-schedules-form">
        <label>
          <span>Task</span>
          <select aria-label="Scheduled task" value={task} onChange={(event) => setTask(event.target.value)}>
            {tasks.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Repeat</span>
          <select aria-label="Schedule repeat" value={repeat} onChange={(event) => setRepeat(event.target.value as "once" | "weekly")}>
            <option value="once">Once</option>
            <option value="weekly">Every week</option>
          </select>
        </label>
        {repeat === "once" ? (
          <label>
            <span>Date</span>
            <input aria-label="Schedule date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        ) : (
          <label>
            <span>Day</span>
            <select aria-label="Schedule day" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
              {WEEKDAYS.map((day, index) => <option key={day} value={String(index + 1)}>{day}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>From</span>
          <input aria-label="Schedule start time" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input aria-label="Schedule end time" type="time" max="17:00" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
        </label>
        <button type="button" className="prototype-button primary" onClick={() => void save()} disabled={busy}>
          Add schedule
        </button>
      </div>

      <div className="nrd-schedules-list">
        {rows.length === 0 ? (
          <p className="nrd-schedules-empty">No scheduled tasks.</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="nrd-schedule-row">
              <strong>{row.task}</strong>
              <span>
                {row.repeat === "weekly"
                  ? `Every ${WEEKDAYS[(row.weekday || 1) - 1]}`
                  : formatDay(row.schedule_date || "")}
              </span>
              <span>{`${row.start_time.slice(0, 5)} – ${row.end_time.slice(0, 5)}`}</span>
              <button type="button" onClick={() => void remove(row)} disabled={busy}>Delete</button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
