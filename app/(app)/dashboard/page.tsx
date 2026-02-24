"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Search, Download, AlertTriangle, Pencil, X } from "lucide-react";

type KPI = {
  devices: number;
  boxes: number;
  imeis_in: number;
  low_stock_devices: number;
};

type BinRow = {
  device_id: string;
  device: string;
  min_stock: number | null;
  imeis_in: number;
  boxes_count: number;
  floors: string[]; // ["00","1","Cabinet"...]
  is_low: boolean;
};

type BoxRow = {
  box_id: string;
  box_no: string;
  floor: string | null;
  imeis_in: number;
};

type Drilldown = {
  ok: boolean;
  device?: {
    device_id: string;
    device: string;
    min_stock: number | null;
    imeis_in: number;
    boxes_count: number;
    floors: string[];
    is_low: boolean;
  };
  boxes?: Array<{
    box_id: string;
    box_no: string;
    floor: string | null;
    imeis_in: number;
    imeis: Array<{
      imei: string;
      imported_at: string | null;
      imported_by: string | null;
    }>;
  }>;
  error?: string;
};

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [kpi, setKpi] = useState<KPI>({
    devices: 0,
    boxes: 0,
    imeis_in: 0,
    low_stock_devices: 0,
  });

  const [bins, setBins] = useState<BinRow[]>([]);

  // UI filters
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  // min stock editing
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [minStockDraft, setMinStockDraft] = useState<string>("");

  // drilldown modal
  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drilldown | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

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
      const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load dashboard");
      }

      setKpi(json.kpi);
      setBins(json.bins || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load dashboard");
      setBins([]);
      setKpi({ devices: 0, boxes: 0, imeis_in: 0, low_stock_devices: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = bins.filter((b) => {
    if (lowOnly && !b.is_low) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (b.device || "").toLowerCase().includes(s);
  });

  function startEditMinStock(row: BinRow) {
    setEditingDeviceId(row.device_id);
    setMinStockDraft(String(row.min_stock ?? ""));
  }

  async function saveMinStock(device_id: string) {
    const v = minStockDraft.trim();
    const num = v === "" ? null : Number(v);

    if (v !== "" && (Number.isNaN(num) || num! < 0)) {
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

  async function openDrilldown(device_id: string) {
    setOpenDeviceId(device_id);
    setDrill(null);
    setDrillLoading(true);

    try {
      const res = await fetch(`/api/dashboard/drilldown?device_id=${encodeURIComponent(device_id)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load drilldown");
      setDrill(json);
    } catch (e: any) {
      setDrill({ ok: false, error: e?.message || "Failed to load drilldown" });
    } finally {
      setDrillLoading(false);
    }
  }

  function closeDrilldown() {
    setOpenDeviceId(null);
    setDrill(null);
    setDrillLoading(false);
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

  return (
    <div className="space-y-6 max-w-6xl">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Dashboard</div>
          <h2 className="text-xl font-semibold">Stock overview</h2>
          <p className="text-sm text-slate-400 mt-1">
            User: <b>{actor}</b>
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadOverview}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Refresh
          </button>

          <button
            onClick={exportExcel}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold flex items-center gap-2"
          >
            <Download size={16} />
            Export Excel
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
        <KpiCard title="Devices (bins)" value={kpi.devices} />
        <KpiCard title="Boxes" value={kpi.boxes} />
        <KpiCard title="IMEIs IN" value={kpi.imeis_in} />
        <KpiCard
          title="Low stock"
          value={kpi.low_stock_devices}
          highlight={kpi.low_stock_devices > 0}
        />
      </div>

      {/* FILTERS */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search device…"
              className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300 select-none">
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Low stock only
          </label>
        </div>
      </div>

      {/* TABLE */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Bins</div>
            <div className="text-xs text-slate-500">
              Click a device to drill down into boxes + IMEIs.
            </div>
          </div>

          {loading && <div className="text-sm text-slate-400">Loading…</div>}
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
                <th className="p-2 border-b border-slate-800 text-right">Alert</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const isEditing = editingDeviceId === b.device_id;

                return (
                  <tr
                    key={b.device_id}
                    className="hover:bg-slate-950/40 cursor-pointer"
                    onClick={() => openDrilldown(b.device_id)}
                  >
                    <td className="p-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{b.device}</span>
                        {b.is_low && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-950/40 border border-amber-500/30 text-amber-200">
                            <AlertTriangle size={14} />
                            LOW
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-2 border-b border-slate-800 text-right font-semibold">
                      {b.imeis_in}
                    </td>

                    <td className="p-2 border-b border-slate-800 text-right">
                      {b.boxes_count}
                    </td>

                    <td className="p-2 border-b border-slate-800">
                      {(b.floors || []).length ? (b.floors || []).join(", ") : "—"}
                    </td>

                    <td
                      className="p-2 border-b border-slate-800 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isEditing ? (
                        <button
                          onClick={() => startEditMinStock(b)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          <Pencil size={14} />
                          {b.min_stock ?? "—"}
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
                            onClick={() => saveMinStock(b.device_id)}
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
                      {b.is_low ? (
                        <span className="text-amber-200 font-semibold">Low</span>
                      ) : (
                        <span className="text-slate-500">OK</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loading && filtered.length === 0 && (
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
          <div className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div>
                <div className="text-xs text-slate-500">Drilldown</div>
                <div className="font-semibold">
                  {drill?.device?.device || "Loading…"}
                </div>
                {drill?.device && (
                  <div className="text-xs text-slate-400 mt-1">
                    IMEIs IN: <b>{drill.device.imeis_in}</b> • Boxes:{" "}
                    <b>{drill.device.boxes_count}</b> • Floors:{" "}
                    <b>{(drill.device.floors || []).join(", ") || "—"}</b>
                  </div>
                )}
              </div>

              <button
                onClick={closeDrilldown}
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold hover:bg-slate-800 inline-flex items-center gap-2"
              >
                <X size={16} />
                Close
              </button>
            </div>

            <div className="p-4 space-y-4">
              {drillLoading && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
                  Loading drilldown…
                </div>
              )}

              {!drillLoading && drill?.ok === false && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
                  {drill?.error || "Failed to load drilldown"}
                </div>
              )}

              {!drillLoading && drill?.ok && (
                <div className="space-y-4">
                  {(drill.boxes || []).map((box) => (
                    <div key={box.box_id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            Box <span className="text-slate-300">{box.box_no}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Floor: <b className="text-slate-300">{box.floor || "—"}</b> • IMEIs IN:{" "}
                            <b className="text-slate-300">{box.imeis_in}</b> • Box ID:{" "}
                            <span className="text-slate-400">{box.box_id}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 overflow-auto">
                        <table className="w-full text-xs border border-slate-800 rounded-xl overflow-hidden">
                          <thead className="bg-slate-950/40">
                            <tr>
                              <th className="p-2 border-b border-slate-800 text-left">IMEI</th>
                              <th className="p-2 border-b border-slate-800 text-left">Imported at</th>
                              <th className="p-2 border-b border-slate-800 text-left">Imported by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(box.imeis || []).map((it) => (
                              <tr key={it.imei} className="hover:bg-slate-950/40">
                                <td className="p-2 border-b border-slate-800 font-mono">{it.imei}</td>
                                <td className="p-2 border-b border-slate-800">
                                  {it.imported_at ? new Date(it.imported_at).toLocaleString() : "—"}
                                </td>
                                <td className="p-2 border-b border-slate-800">
                                  {it.imported_by || "—"}
                                </td>
                              </tr>
                            ))}

                            {(box.imeis || []).length === 0 && (
                              <tr>
                                <td colSpan={3} className="p-3 text-slate-400">
                                  No IMEIs currently IN for this box.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}

                  {(drill.boxes || []).length === 0 && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
                      No boxes found for this device.
                    </div>
                  )}
                </div>
              )}
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={"mt-2 text-2xl font-semibold " + (highlight ? "text-amber-200" : "")}>
        {value}
      </div>
    </div>
  );
}