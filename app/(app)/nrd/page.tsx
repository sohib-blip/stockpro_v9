"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const NRD_TASKS = [
  "Prepare FMC234",
  "Clean Shelves",
  "Stock Take",
  "Re-stock",
  "Receive Incoming Orders",
  "Returns",
  "Consumables - Stock Take & Orders",
  "Preparing DVRs & Adding SIMs",
  "Order Checks",
  "Mail & Case Handling",
  "Tidying Up the Workspace",

  // New tasks
  "Overtime",
  "Container",
  "Team Meeting",
  "Stock Revision",
  "Training",
  "Working on StockPro",
];

function formatTimer(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")}`;
}

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString("fr-BE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("fr-BE");
}

function formatHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function getCurrentPeriodMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function NRDPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [task, setTask] = useState(NRD_TASKS[0]);
  const [active, setActive] = useState<any>(null);
  const [seconds, setSeconds] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [periodMonth, setPeriodMonth] = useState(getCurrentPeriodMonth());

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showForgottenModal, setShowForgottenModal] = useState(false);
  const [forgottenModalDismissed, setForgottenModalDismissed] = useState(false);

  const [correctEndTime, setCorrectEndTime] = useState("");


  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      if (user?.email) setUserEmail(user.email);
      if (user?.id) setUserId(user.id);
    })();
  }, [supabase]);

  async function loadCurrent(email = userEmail) {
  if (!email) return;

  const res = await fetch(
    `/api/nrd/current?user_email=${encodeURIComponent(
      email
    )}&t=${Date.now()}`,
    { cache: "no-store" }
  );

  const json = await res.json();

  if (json.ok) {
    setActive(json.active || null);

    if (json.active) {
      setForgottenModalDismissed(false);
    }
  }
}
  async function loadHistory(email = userEmail, month = periodMonth) {
  if (!email) return;

  const res = await fetch(
    `/api/nrd/history?user_email=${encodeURIComponent(
      email
    )}&period_month=${encodeURIComponent(month)}&t=${Date.now()}`,
    { cache: "no-store" }
  );

  const json = await res.json();

  if (json.ok) {
    setHistory(json.rows || []);
  }
}

  async function loadStats(email = userEmail, month = periodMonth) {
    if (!email) return;

    const res = await fetch(
      `/api/nrd/stats?user_email=${encodeURIComponent(
        email
      )}&period_month=${encodeURIComponent(month)}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json.ok) {
      setStats(json);
    }
  }

  useEffect(() => {
    if (userEmail) {
      loadCurrent(userEmail);
      loadHistory(userEmail);
      loadStats(userEmail, periodMonth);
    }
  }, [userEmail, periodMonth]);

  useEffect(() => {
    if (!active?.started_at) {
      setSeconds(0);
      return;
    }

    const tick = () => {
      const started = new Date(active.started_at).getTime();
      const now = Date.now();
      setSeconds(Math.max(0, Math.floor((now - started) / 1000)));

      if (
  now - started >= 8 * 60 * 60 * 1000 &&
  !showForgottenModal &&
  !forgottenModalDismissed
) {
  const nowDate = new Date();
const localDateTime = new Date(
  nowDate.getTime() - nowDate.getTimezoneOffset() * 60_000
)
  .toISOString()
  .slice(0, 16);

setCorrectEndTime(localDateTime);

  setShowForgottenModal(true);
}
    };

    tick();

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active, showForgottenModal, forgottenModalDismissed]);

  async function startTask() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await fetch("/api/nrd/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        user_email: userEmail,
        task,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Start failed");
      if (json.active) setActive(json.active);
      return;
    }

    setActive(json.row);
setShowForgottenModal(false);
setForgottenModalDismissed(false);
setCorrectEndTime("");

setSuccessMsg("Task started");
setTimeout(() => setSuccessMsg(""), 2000);
  }

  async function stopTask() {
  setBusy(true);
  setErrorMsg("");
  setSuccessMsg("");

  const res = await fetch("/api/nrd/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_email: userEmail,
    }),
  });

  const json = await res.json();
  setBusy(false);

  if (!json.ok) {
    setErrorMsg(json.error || "Stop failed");
    return;
  }

  setActive(null);
  setShowForgottenModal(false);
setForgottenModalDismissed(false);
setCorrectEndTime("");
  setSuccessMsg("Task stopped");
  setTimeout(() => setSuccessMsg(""), 2000);

  await loadHistory(userEmail, periodMonth);
  await loadStats(userEmail, periodMonth);
  await loadCurrent(userEmail);
}

async function stopTaskWithCorrection() {
  if (!correctEndTime) {
    setErrorMsg("Please select the real end time.");
    return;
  }

  setBusy(true);
  setErrorMsg("");
  setSuccessMsg("");

  try {
    const res = await fetch("/api/nrd/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_email: userEmail,
        ended_at: new Date(correctEndTime).toISOString(),
      }),
    });

    const json = await res.json();

    if (!json.ok) {
      setErrorMsg(json.error || "Corrected stop failed");
      return;
    }

    setShowForgottenModal(false);
    setForgottenModalDismissed(false);
    setCorrectEndTime("");
    setActive(null);
    setSuccessMsg("NRD corrected and stopped");
    setTimeout(() => setSuccessMsg(""), 2000);

    await loadCurrent(userEmail);
    await loadHistory(userEmail, periodMonth);
    await loadStats(userEmail, periodMonth);
  } catch {
    setErrorMsg("Corrected stop failed");
  } finally {
    setBusy(false);
  }
}

  return (
    <div className="space-y-6 w-full">
      {showForgottenModal && active && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
    <div className="sp-card sp-card-flush w-full max-w-lg">
      <div className="border-b border-sp-border p-5">
        <div className="sp-eyebrow text-sp-warn">
          NRD review
        </div>

        <h2 className="mt-1 text-xl font-semibold text-sp-text">
           Confirm NRD end
        </h2>
      </div>

      <div className="space-y-5 p-5">
        <div className="sp-alert sp-alert-warn">
          <div className="font-semibold">
            This NRD has been active for {formatTimer(seconds)}.
          </div>

          <div className="mt-2">
            Confirm that the task ended now, or choose the actual end time below.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="sp-kpi-label">Task</div>
            <div className="mt-1 font-semibold text-sp-text">{active.task}</div>
          </div>

          <div>
            <div className="sp-kpi-label">Started</div>
            <div className="mt-1 text-sp-body">
              {new Date(active.started_at).toLocaleString("fr-BE")}
            </div>
          </div>
        </div>

        <div>
          <label className="sp-label">
            Real end date and time
          </label>

          <input
            type="datetime-local"
            value={correctEndTime}
            min={(() => {
              const started = new Date(active.started_at);

              return new Date(
                started.getTime() - started.getTimezoneOffset() * 60_000
              )
                .toISOString()
                .slice(0, 16);
            })()}
            max={(() => {
              const now = new Date();

              return new Date(
                now.getTime() - now.getTimezoneOffset() * 60_000
              )
                .toISOString()
                .slice(0, 16);
            })()}
            onChange={(e) => setCorrectEndTime(e.target.value)}
            className="sp-input"
          />

          <div className="mt-2 text-xs text-sp-muted">
            The NRD duration will be recalculated using this end time.
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-sp-border pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
  setShowForgottenModal(false);
  setForgottenModalDismissed(true);
  setCorrectEndTime("");
            }}
            disabled={busy}
            className="sp-btn sp-btn-ghost"
          >
            Keep running
          </button>

          <button
            type="button"
            onClick={stopTask}
            disabled={busy}
            className="sp-btn sp-btn-danger"
          >
            {busy ? "Stopping..." : "It ended now"}
          </button>

          <button
            type="button"
            onClick={stopTaskWithCorrection}
            disabled={busy || !correctEndTime}
            className="sp-btn sp-btn-danger"
          >
            {busy ? "Saving..." : "Correct & stop"}
          </button>
        </div>
      </div>
    </div>
  </div>
)}
      <div className="sp-page-header">
        <div>
        <div className="sp-eyebrow">NRD</div>
        <h2 className="sp-title">NRD Tracker</h2>
        <p className="sp-desc">
          User: <b>{userEmail || "loading..."}</b>
        </p>
        </div>
      </div>

      {errorMsg && (
        <div className="sp-alert sp-alert-err">{errorMsg}</div>
      )}

      {successMsg && (
        <div className="sp-alert sp-alert-ok">{successMsg}</div>
      )}

      <section className="sp-card space-y-5">
        <div className="font-semibold text-sp-text">Current NRD Task</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="sp-label">Task</label>
            <select
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={!!active}
              className="sp-select"
            >
              {NRD_TASKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="sp-card sp-card-tight bg-sp-primary-tint text-center">
            <div className="sp-kpi-label">Timer</div>
            <div className="mt-2 font-mono text-4xl font-bold tracking-[0.14em] text-sp-primary sm:text-5xl">
              {formatTimer(seconds)}
            </div>
          </div>
        </div>

        {active && (
          <div className="rounded-lg border border-sp-border bg-sp-bg-soft px-4 py-3 text-sm">
            <div className="text-sp-secondary">Active task</div>
            <div className="font-semibold mt-1 text-sp-text">{active.task}</div>
            <div className="text-xs text-sp-muted mt-1">
              Started at: {new Date(active.started_at).toLocaleString()}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {!active ? (
            <button
              onClick={startTask}
              disabled={busy || !userEmail}
              className="sp-btn sp-btn-primary"
            >
              {busy ? "Starting..." : "Start Task"}
            </button>
          ) : (
            <button
  onClick={() => {
    const nowDate = new Date();

    const localDateTime = new Date(
      nowDate.getTime() - nowDate.getTimezoneOffset() * 60_000
    )
      .toISOString()
      .slice(0, 16);

    setCorrectEndTime(localDateTime);
    setShowForgottenModal(true);
  }}
  disabled={busy}
  className="sp-btn sp-btn-danger"
>
  {busy ? "Stopping..." : "Stop Task"}
</button>
          )}

          <button
            onClick={() => {
              loadHistory(userEmail, periodMonth);
              loadStats(userEmail, periodMonth);
            }}
            disabled={busy || !userEmail}
            className="sp-btn sp-btn-ghost"
          >
            Refresh
          </button>

<a
  href={
    userEmail
      ? `/api/nrd/export?user_email=${encodeURIComponent(
          userEmail
        )}&period_month=${encodeURIComponent(periodMonth)}`
      : "#"
  }
  className={`sp-btn sp-btn-ghost ${
    !userEmail ? "opacity-40 pointer-events-none" : ""
  }`}
>
  Export Excel
</a>

{["martine.gevaert@radius.com", "emily.vancauwenberge@radius.com"].includes(
  userEmail.toLowerCase()
) && (
  <a
    href={
      userEmail
        ? `/api/nrd/export-global?user_email=${encodeURIComponent(
            userEmail
          )}&period_month=${encodeURIComponent(periodMonth)}`
        : "#"
    }
    className="sp-btn sp-btn-ghost text-sp-primary"
  >
    Export Global Excel
  </a>
)}

        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="sp-card sp-card-tight">
          <div className="sp-kpi-label mb-2">Selected month</div>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="sp-select"
          />
        </div>

        <div className="sp-card sp-card-tight">
          <div className="sp-kpi-label">Total time</div>
          <div className="sp-kpi-value">
            {formatHours(Number(stats?.total_minutes || 0))}
          </div>
        </div>

        <div className="sp-card sp-card-tight">
          <div className="sp-kpi-label">Completed tasks</div>
          <div className="sp-kpi-value">
            {stats?.tasks_count || 0}
          </div>
        </div>
      </div>

      <section className="sp-card space-y-4">
        <div className="font-semibold text-sp-text">Task Breakdown</div>

        <div className="space-y-3">
          {stats?.by_task?.length ? (
            stats.by_task.map((row: any) => (
              <div key={row.task}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-sp-body font-semibold">
                    {row.task}
                  </span>
                  <span className="text-sp-muted">
                    {formatHours(Number(row.minutes || 0))}
                  </span>
                </div>

                <div className="w-full bg-sp-bg h-2 rounded-full">
                  <div
                    className="bg-sp-primary h-2 rounded-full"
                    style={{
                      width: `${
                        stats.total_minutes
                          ? Math.round(
                              (Number(row.minutes || 0) /
                                Number(stats.total_minutes || 1)) *
                                100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-sp-muted">
              No completed NRD tasks for this month.
            </div>
          )}
        </div>
      </section>

      <section className="sp-card sp-card-flush">
        <div className="flex justify-between items-center px-6 py-5">
          <div className="font-semibold text-sp-text">My NRD History</div>
          <div className="text-xs text-sp-muted">
            Last {history.length} activities
          </div>
        </div>

        <div className="overflow-x-auto border-t border-sp-border">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Start</th>
                <th>End</th>
                <th>Task</th>
                <th className="text-right">Minutes</th>
              </tr>
            </thead>

            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-sp-muted">
                    No NRD history yet.
                  </td>
                </tr>
              )}

              {history.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.started_at)}</td>
                  <td>{formatTime(row.started_at)}</td>
                  <td>
                    {row.ended_at ? formatTime(row.ended_at) : "-"}
                  </td>
                  <td>{row.task}</td>
                  <td className="text-right font-semibold">
                    {row.duration_minutes ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
