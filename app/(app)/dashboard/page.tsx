"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  device_id: string;
  device: string;
  canonical_name: string;
  imeis: number;
  boxes: number;
  floors: string[];
  low_stock: boolean;
};

function floorColor(floor: string) {
  switch (floor) {
    case "00":
      return "bg-blue-950/40 border-blue-500/40 text-blue-200";
    case "1":
      return "bg-purple-950/40 border-purple-500/40 text-purple-200";
    case "6":
      return "bg-indigo-950/40 border-indigo-500/40 text-indigo-200";
    case "Cabinet":
      return "bg-orange-950/40 border-orange-500/40 text-orange-200";
    default:
      return "bg-slate-950 border-slate-700 text-slate-300";
  }
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setRows(json.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter(
      (r) =>
        r.device.toLowerCase().includes(qq) ||
        r.canonical_name.toLowerCase().includes(qq)
    );
  }, [rows, q]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Dashboard</div>
        <h2 className="text-xl font-semibold">Warehouse Overview</h2>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search device…"
          className="w-full md:w-[360px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        {loading ? (
          <div className="text-sm text-slate-300">Loading…</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <div
                key={r.device_id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 hover:bg-slate-950 transition-all duration-200"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-lg">
                      {r.device}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.boxes} boxes • {r.imeis} IMEIs
                    </div>
                  </div>

                  <div>
                    {r.imeis === 0 ? (
                      <span className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1 text-xs font-semibold text-rose-200">
                        OUT
                      </span>
                    ) : r.low_stock ? (
                      <span className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-xs font-semibold text-amber-200">
                        LOW
                      </span>
                    ) : (
                      <span className="rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-200">
                        OK
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {r.floors.length > 0 ? (
                    r.floors.map((f) => (
                      <span
                        key={f}
                        className={`px-2 py-1 text-xs rounded-lg border ${floorColor(
                          f
                        )}`}
                      >
                        {f}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">
                      No floor assigned
                    </span>
                  )}
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="text-slate-400 text-sm">
                No devices.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}