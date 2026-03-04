"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Search, Download, AlertTriangle, Pencil, X } from "lucide-react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid
} from "recharts";

type Level = "ok" | "low" | "empty";

type KPI = {
  total_in: number;
  total_out: number;
  total_devices: number;
  total_boxes: number;
  alerts: number;
};

type DeviceSummaryRow = {
  device_id: string;
  device: string;
  total_in: number;
  total_out: number;
  min_stock: number;
  level: Level;
};

type BoxSummaryRow = {
  box_id: string;
  device_id: string;
  device: string;
  box_code: string;
  floor: string | null;
  remaining: number;
  total: number;
  percent: number;
  level: Level;
};

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [kpi, setKpi] = useState<KPI>({
    total_in: 0,
    total_out: 0,
    total_devices: 0,
    total_boxes: 0,
    alerts: 0,
  });

  const [devices, setDevices] = useState<DeviceSummaryRow[]>([]);
  const [boxes, setBoxes] = useState<BoxSummaryRow[]>([]);
const [chartData, setChartData] = useState<any[]>([]);

  // UI filters
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  // min stock editing
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [minStockDraft, setMinStockDraft] = useState<string>("");

  // drilldown modal (local drilldown from boxSummary)
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadOverview() {
    setLoading(true);
    setErr("");

    try {
      const res = await fetch(`/api/dashboard/overview?t=${Date.now()}`, { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load dashboard");
      }

      const kpis: KPI =
        json.kpis || json.kpi || {
          total_in: 0,
          total_out: 0,
          total_devices: 0,
          total_boxes: 0,
          alerts: 0,
        };

      const devs: DeviceSummaryRow[] = (json.deviceSummary || json.devices || []).map((d: any) => ({
        device_id: String(d.device_id ?? ""),
        device: String(d.device ?? ""),
        total_in: Number(d.total_in ?? 0),
        total_out: Number(d.total_out ?? 0),
        min_stock: Number(d.min_stock ?? 0),
        level: (d.level as Level) || "ok",
      }));

      const bxs: BoxSummaryRow[] = (json.boxSummary || json.boxes || []).map((b: any) => ({
        box_id: String(b.box_id ?? b.id ?? ""),
        device_id: String(b.device_id ?? b.bin_id ?? ""),
        device: String(b.device ?? ""),
        box_code: String(b.box_code ?? b.box_no ?? ""),
        floor: b.floor ?? null,
        remaining: Number(b.remaining ?? 0),
        total: Number(b.total ?? 0),
        percent: Number(b.percent ?? 0),
        level: (b.level as Level) || "ok",
      }));

      setKpi(kpis);
setDevices(devs);
setBoxes(bxs);

// LOAD GRAPH 30 DAYS
const graphRes = await fetch(`/api/dashboard/flow30?t=${Date.now()}`, {
  cache: "no-store",
});

const graphJson = await graphRes.json();

if (graphJson?.ok) {
  setChartData(graphJson.rows || []);
}

} catch (e: any) {
      setErr(e?.message || "Failed to load dashboard");
      setKpi({ total_in: 0, total_out: 0, total_devices: 0, total_boxes: 0, alerts: 0 });
      setDevices([]);
      setBoxes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ GLOBAL FILTER HELPERS
  const search = q.trim().toLowerCase();

  function deviceMatchesSearch(d: DeviceSummaryRow) {
    if (!search) return true;
    return (d.device || "").toLowerCase().includes(search);
  }

  function boxMatchesSearch(b: BoxSummaryRow) {
    if (!search) return true;
    return (
      (b.device || "").toLowerCase().includes(search) ||
      (b.box_code || "").toLowerCase().includes(search)
    );
  }

  // ✅ Filter devices (unchanged logic + global search)
  const filteredDevices = devices.filter((d) => {
    if (lowOnly && d.level === "ok") return false;
    return deviceMatchesSearch(d);
  });

  // KPI filtered values
const filteredDeviceIds = new Set(filteredDevices.map(d => d.device_id));

const filteredBoxesForKpi = boxes.filter(b =>
  filteredDeviceIds.has(b.device_id)
);

const filteredTotalIn = filteredDevices.reduce(
  (sum, d) => sum + d.total_in,
  0
);

const filteredAlerts = filteredDevices.filter(
  d => d.level !== "ok"
).length;

  // ✅ Filter boxes for "whole page filter"
  const filteredBoxes = boxes.filter((b) => boxMatchesSearch(b));

  // ✅ Floors display with exact counts (boxes + IMEIs)
  function floorsForDevice(device_id: string): string {
    const agg = new Map<string, { boxes: number; imeis: number }>();

    for (const b of filteredBoxes) {
      if (b.device_id !== device_id) continue;

      const floor = (b.floor ?? "—").toString();

      const prev = agg.get(floor) || { boxes: 0, imeis: 0 };
      prev.boxes += 1;
      prev.imeis += Number(b.remaining ?? 0);
      agg.set(floor, prev);
    }

    const floors = Array.from(agg.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([floor, v]) => `${floor} (${v.boxes} boxes / ${v.imeis} IMEIs)`);

    return floors.length ? floors.join(", ") : "—";
  }

  // ✅ Boxes count must respect global filter too
  function boxesCountForDevice(device_id: string): number {
    return filteredBoxes.filter((b) => b.device_id === device_id).length;
  }

  function startEditMinStock(row: DeviceSummaryRow) {
    setEditingDeviceId(row.device_id);
    setMinStockDraft(String(row.min_stock ?? ""));
  }

  async function saveMinStock(device_id: string) {
    const v = minStockDraft.trim();
    const num = v === "" ? null : Number(v);

    if (v !== "" && (Number.isNaN(num) || (num as number) < 0)) {
      alert("min_stock must be a number >= 0 (or empty)");
      return;
    }

    const res = await fetch("/api/dashboard/update-minstock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id, min_stock: num, actor }),
    });

    const json = await res.json();
    if (!json.ok) {
      alert("❌ " + (json.error || "Failed to update min_stock"));
      return;
    }

    setEditingDeviceId(null);
    setMinStockDraft("");
    await loadOverview();
  }

  async function exportExcel() {
    setErr("");
    try {
      const res = await fetch("/api/dashboard/export", { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Export failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || "Export failed");
    }
  }

  const openDevice = openDeviceId
    ? devices.find((d) => d.device_id === openDeviceId) || null
    : null;

  // ✅ drilldown should also respect global filter
  const drillBoxes = openDeviceId
    ? filteredBoxes
        .filter((b) => b.device_id === openDeviceId)
        .sort((a, b) => (a.box_code || "").localeCompare(b.box_code || ""))
    : [];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-6">

  {/* TITLE */}
  <div>
    <div className="text-xs text-slate-500">Dashboard</div>
    <h2 className="text-xl font-semibold">Stock overview</h2>
    <p className="text-sm text-slate-400 mt-1">
      User: <b>{actor}</b>
    </p>
  </div>

  {/* RIGHT SIDE */}
  <div className="flex items-center gap-3">

    {/* SEARCH */}
    <div className="relative">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        size={16}
      />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search device..."
        className="w-[220px] rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-700"
      />
    </div>

    {/* REFRESH */}
    <button
      onClick={loadOverview}
      className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
    >
      Refresh
    </button>

    {/* EXPORT */}
    <button
      onClick={exportExcel}
      className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold flex items-center gap-2"
    >
      <Download size={16} />
      Export
    </button>

  </div>
</div>

      {/* ERROR */}
      {err && (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {err}
        </div>
      )}

      {/* KPI */}
<div className="grid grid-cols-1 md:grid-cols-4 gap-3">
  <KpiCard title="Devices (bins)" value={filteredDevices.length} />

  <KpiCard title="Boxes" value={filteredBoxesForKpi.length} />

  <KpiCard title="IMEIs IN" value={filteredTotalIn} />

  <KpiCard
    title="Alerts"
    value={filteredAlerts}
    highlight={filteredAlerts > 0}
  />
</div>

{/* GRAPH 30 DAYS */}
<div className="card-glow p-6 relative overflow-hidden">
  <div className="absolute inset-0 opacity-30 pointer-events-none">

  <div className="absolute -top-40 left-1/4 w-96 h-96 bg-sky-500 blur-[120px]" />

  <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500 blur-[120px]" />

</div>

  <div className="font-semibold mb-4">Stock flow (last 30 days)</div>

  <div className="w-full h-64">
    <ResponsiveContainer>
      <LineChart data={chartData}>
  <defs>
    <linearGradient id="inGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.9}/>
      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0}/>
    </linearGradient>

    <linearGradient id="outGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.9}/>
      <stop offset="100%" stopColor="#a855f7" stopOpacity={0}/>
    </linearGradient>
  </defs>

  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>

  <XAxis dataKey="date" stroke="#94a3b8"/>
  <YAxis stroke="#94a3b8"/>

  <Tooltip/>

  {Object.keys(chartData[0] || {})
  .filter(k => k !== "date")
  .map((key,i) => (
    <Line
      key={key}
      type="monotone"
      dataKey={key}
      strokeWidth={2}
      dot={false}
      stroke={`hsl(${i*60},70%,60%)`}
    />
))}
</LineChart>
    </ResponsiveContainer>
  </div>
</div>

{/* TOP DEVICES */}

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">

  {/* LEFT SIDE */}

  <div className="md:col-span-2">

    <div className="card-glow p-6 relative overflow-hidden">

      <div className="font-semibold mb-4">
        Top Devices
      </div>

      <div className="space-y-4">

        {filteredDevices.slice(0,5).map((d) => {

          const percent = Math.min(100, Math.round((d.total_in / 2000) * 100))

          return (

            <div key={d.device_id}>

              <div className="flex justify-between text-sm mb-1">
                <span>{d.device}</span>
                <span className="text-slate-400">{d.total_in}</span>
              </div>

              <div className="w-full bg-slate-800 rounded-full h-2">

                <div
                  className="h-2 rounded-full bg-gradient-to-r from-sky-400 to-indigo-500"
                  style={{ width: `${percent}%` }}
                />

              </div>

            </div>

          )

        })}

      </div>

    </div>

  </div>


  {/* RIGHT SIDE */}

  <div>

    <div className="card-glow p-6 relative overflow-hidden">

      <div className="font-semibold mb-4">
        Recent Activity
      </div>

      <div className="space-y-3 text-sm">

        <div className="flex justify-between">
          <span className="text-emerald-400">+120</span>
          <span>Teltonika</span>
          <span className="text-slate-500">2h</span>
        </div>

        <div className="flex justify-between">
          <span className="text-rose-400">-95</span>
          <span>Queclink</span>
          <span className="text-slate-500">5h</span>
        </div>

        <div className="flex justify-between">
          <span className="text-emerald-400">+60</span>
          <span>DigitalMatter</span>
          <span className="text-slate-500">1d</span>
        </div>

      </div>

    </div>

  </div>

</div>

      {/* TABLE */}
      <div className="card-glow p-6 space-y-3">
        <div>
          <div className="font-semibold">Bins</div>
          <div className="text-xs text-slate-500">Click a device to view boxes (drilldown).</div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 border-b border-slate-800 text-left">Device (bin)</th>
                <th className="p-2 border-b border-slate-800 text-right">IMEIs IN</th>
                <th className="p-2 border-b border-slate-800 text-right">Boxes</th>
                <th className="p-2 border-b border-slate-800 text-left">Floors</th>
                <th className="p-2 border-b border-slate-800 text-right">Min stock</th>
                <th className="p-2 border-b border-slate-800 text-right">Status</th>
              </tr>
            </thead>

            <tbody>
              {filteredDevices.map((d) => {
                const isEditing = editingDeviceId === d.device_id;

                const floorsText = floorsForDevice(d.device_id);
                const boxesCount = boxesCountForDevice(d.device_id);

                const isLow = d.level !== "ok";

                return (
                  <tr
                    key={d.device_id}
                    className="hover:bg-slate-950/40 cursor-pointer"
                    onClick={() => setOpenDeviceId(d.device_id)}
                  >
                    <td className="p-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{d.device}</span>

                        {isLow && (
                          <span
                            className={
                              "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border " +
                              (d.level === "empty"
                                ? "bg-rose-950/40 border-rose-500/30 text-rose-200"
                                : "bg-amber-950/40 border-amber-500/30 text-amber-200")
                            }
                          >
                            <AlertTriangle size={14} />
                            {d.level === "empty" ? "EMPTY" : "LOW"}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-2 border-b border-slate-800 text-right font-semibold">{d.total_in}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{boxesCount}</td>

                    <td className="p-2 border-b border-slate-800">
                      {floorsText}
                      <span className="ml-2 text-xs text-slate-500">(from boxes)</span>
                    </td>

                    <td className="p-2 border-b border-slate-800 text-right" onClick={(e) => e.stopPropagation()}>
                      {!isEditing ? (
                        <button
                          onClick={() => startEditMinStock(d)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          <Pencil size={14} />
                          {Number.isFinite(d.min_stock) ? d.min_stock : "—"}
                        </button>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            value={minStockDraft}
                            onChange={(e) => setMinStockDraft(e.target.value)}
                            className="w-24 rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs"
                            placeholder="ex: 20"
                            autoFocus
                          />
                          <button
                            onClick={() => saveMinStock(d.device_id)}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingDeviceId(null)}
                            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>

                    <td className="p-2 border-b border-slate-800 text-right">
                      {d.level === "ok" ? (
                        <span className="text-slate-500">OK</span>
                      ) : d.level === "empty" ? (
                        <span className="text-rose-200 font-semibold">Empty</span>
                      ) : (
                        <span className="text-amber-200 font-semibold">Low</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-slate-400">
                    No devices match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DRILLDOWN MODAL */}
      {openDeviceId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="card-glow w-full max-w-5xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-500">Drilldown</div>
                <div className="font-semibold">{openDevice?.device || "Device"}</div>
                {!!openDevice && (
                  <div className="text-xs text-slate-400 mt-1">
                    IN: <b>{openDevice.total_in}</b> • OUT: <b>{openDevice.total_out}</b> • Min stock:{" "}
                    <b>{openDevice.min_stock}</b>
                  </div>
                )}
              </div>

              <button
                onClick={() => setOpenDeviceId(null)}
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold hover:bg-slate-800 inline-flex items-center gap-2"
              >
                <X size={16} />
                Close
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              {drillBoxes.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                  No boxes for this device (with current filters).
                </div>
              ) : (
                <div className="space-y-3">
                  {drillBoxes.map((b) => (
                    <div key={b.box_id} className="card-glow p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            Box <span className="text-slate-300">{b.box_code}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Floor: <b className="text-slate-300">{b.floor || "—"}</b> • Remaining IN:{" "}
                            <b className="text-slate-300">{b.remaining}</b> • Total ever:{" "}
                            <b className="text-slate-300">{b.total}</b> • {b.percent}%
                          </div>
                          <div className="text-[11px] text-slate-600 mt-1">Box ID: {b.box_id}</div>
                        </div>

                        <div className="text-xs">
                          {b.level === "ok" ? (
                            <span className="text-slate-500">OK</span>
                          ) : b.level === "empty" ? (
                            <span className="text-rose-200 font-semibold">Empty</span>
                          ) : (
                            <span className="text-amber-200 font-semibold">Low</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-slate-500">
                Note: la liste IMEIs par box (imported_at/imported_by) arrive via l’export Excel / route dédiée.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="card-glow p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={"mt-2 text-3xl kpi-number " + (highlight ? "text-amber-200" : "")}>
        {value}
      </div>
    </div>
  );
}