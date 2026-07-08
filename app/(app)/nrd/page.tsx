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
      `/api/nrd/current?user_email=${encodeURIComponent(email)}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json.ok) {
      setActive(json.active || null);
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
    };

    tick();

    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active]);

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
    setSuccessMsg("Task stopped");
    setTimeout(() => setSuccessMsg(""), 2000);

    await loadHistory(userEmail, periodMonth);
    await loadStats(userEmail, periodMonth);
    await loadCurrent(userEmail);
  }

  return (
    <div className="space-y-10 w-full">
      <div>
        <div className="text-xs text-slate-500">NRD</div>
        <h2 className="text-xl font-semibold">NRD Tracker</h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{userEmail || "loading..."}</b>
        </p>
      </div>

      {errorMsg && (
        <div className="bg-red-600/20 border border-red-500 text-red-300 px-4 py-3 rounded-xl text-sm">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-600/20 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-xl text-sm">
          {successMsg}
        </div>
      )}

      <div className="card-glow p-6 space-y-5 relative overflow-hidden">
        <div className="font-semibold">Current NRD Task</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-400 mb-2">Task</div>
            <select
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={!!active}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              {NRD_TASKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-2">Timer</div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-2xl font-semibold tracking-widest">
              {formatTimer(seconds)}
            </div>
          </div>
        </div>

        {active && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm">
            <div className="text-slate-400">Active task</div>
            <div className="font-semibold mt-1">{active.task}</div>
            <div className="text-xs text-slate-500 mt-1">
              Started at: {new Date(active.started_at).toLocaleString()}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {!active ? (
            <button
              onClick={startTask}
              disabled={busy || !userEmail}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Starting..." : "Start Task"}
            </button>
          ) : (
            <button
              onClick={stopTask}
              disabled={busy}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
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
            className="rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 px-4 py-2 font-semibold disabled:opacity-40"
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
  className={`rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 px-4 py-2 font-semibold ${
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
    className="rounded-xl border border-purple-500/50 bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 px-4 py-2 font-semibold"
  >
    Export Global Excel
  </a>
)}

        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Selected month</div>
          <input
            type="month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Total time</div>
          <div className="text-3xl font-bold text-cyan-400">
            {formatHours(Number(stats?.total_minutes || 0))}
          </div>
        </div>

        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Completed tasks</div>
          <div className="text-3xl font-bold text-purple-400">
            {stats?.tasks_count || 0}
          </div>
        </div>
      </div>

      <div className="card-glow p-6 space-y-4 relative overflow-hidden">
        <div className="font-semibold">Task Breakdown</div>

        <div className="space-y-3">
          {stats?.by_task?.length ? (
            stats.by_task.map((row: any) => (
              <div key={row.task}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-cyan-400 font-semibold">
                    {row.task}
                  </span>
                  <span className="text-slate-400">
                    {formatHours(Number(row.minutes || 0))}
                  </span>
                </div>

                <div className="w-full bg-white/10 h-2 rounded">
                  <div
                    className="bg-purple-500 h-2 rounded"
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
            <div className="text-sm text-slate-500">
              No completed NRD tasks for this month.
            </div>
          )}
        </div>
      </div>

      <div className="card-glow p-6 space-y-4 relative overflow-hidden">
        <div className="flex justify-between items-center">
          <div className="font-semibold">My NRD History</div>
          <div className="text-xs text-slate-400">
            Last {history.length} activities
          </div>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Start</th>
                <th className="p-2 text-left">End</th>
                <th className="p-2 text-left">Task</th>
                <th className="p-2 text-right">Minutes</th>
              </tr>
            </thead>

            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500">
                    No NRD history yet.
                  </td>
                </tr>
              )}

              {history.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  <td className="p-2">{formatDate(row.started_at)}</td>
                  <td className="p-2">{formatTime(row.started_at)}</td>
                  <td className="p-2">
                    {row.ended_at ? formatTime(row.ended_at) : "-"}
                  </td>
                  <td className="p-2">{row.task}</td>
                  <td className="p-2 text-right font-semibold">
                    {row.duration_minutes ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}