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

function StatusBadge({ imeis, low }: { imeis: number; low: boolean }) {
  if (imeis === 0)
    return (
      <span className="px-3 py-1 text-xs font-semibold rounded-lg border border-rose-500/40 bg-rose-950/40 text-rose-200">
        OUT
      </span>
    );

  if (low)
    return (
      <span className="px-3 py-1 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-950/40 text-amber-200">
        LOW
      </span>
    );

  return (
    <span className="px-3 py-1 text-xs font-semibold rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-200">
      OK
    </span>
  );
}

function KPI({
  title,
  value,
  sub,
}: {
  title: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<string>("all");

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
    let data = rows;

    if (selectedDevice !== "all") {
      data = data.filter((r) => r.device === selectedDevice);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.device.toLowerCase().includes(q) ||
          r.canonical_name.toLowerCase().includes(q)
      );
    }

    return data;
  }, [rows, search, selectedDevice]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        acc.boxes += r.boxes;
        acc.imeis += r.imeis;
        acc.devices += 1;
        return acc;
      },
      { boxes: 0, imeis: 0, devices: 0 }
    );
  }, [filtered]);

  const deviceOptions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.device))).sort();
  }, [rows]);

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <div className="text-xs text-slate-500">Dashboard</div>
        <h2 className="text-2xl font-semibold">Warehouse Overview</h2>
      </div>

      {/* KPI SECTION */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KPI title="Devices" value={totals.devices} />
        <KPI title="Total Boxes" value={totals.boxes} />
        <KPI title="Total IMEIs" value={totals.imeis} />
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="all">All Devices</option>
          {deviceOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search device…"
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm w-full md:w-[300px]"
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-sm text-slate-400">Loading…</div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((r) => (
            <div
              key={r.device_id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5 hover:border-slate-700 transition-all"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-lg font-semibold">{r.device}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {r.boxes} boxes • {r.imeis} IMEIs
                  </div>
                </div>

                <StatusBadge imeis={r.imeis} low={r.low_stock} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
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
            <div className="text-sm text-slate-500">
              No results.
            </div>
          )}
        </div>
      )}
    </div>
  );
}