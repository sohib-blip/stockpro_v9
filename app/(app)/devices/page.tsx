"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  device_id: string;
  device: string;
  canonical_name: string;
  units_per_imei: number;
  min_stock: number;
  imeis: number;
  boxes: number;
  items: number;
  low_stock: boolean;
};

export default function DevicesPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed");
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
    return rows.filter((r) => {
      return (
        r.device.toLowerCase().includes(qq) ||
        r.canonical_name.toLowerCase().includes(qq)
      );
    });
  }, [rows, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Inventory</div>
          <h2 className="text-xl font-semibold">Devices inventory</h2>
          <p className="text-sm text-slate-400 mt-1">
            Search + totals par device.
          </p>
        </div>

        <button
          onClick={load}
          className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
        >
          Refresh
        </button>
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
          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-right p-2 border-b border-slate-800">Items</th>
                  <th className="text-right p-2 border-b border-slate-800">IMEIs</th>
                  <th className="text-right p-2 border-b border-slate-800">Boxes</th>
                  <th className="text-right p-2 border-b border-slate-800">Units/IMEI</th>
                  <th className="text-right p-2 border-b border-slate-800">Min</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.device_id} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800">
                      <div className="font-semibold">{r.device}</div>
                      <div className="text-xs text-slate-500">{r.canonical_name}</div>
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right font-semibold">
                      {r.items}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">{r.imeis}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{r.boxes}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{r.units_per_imei}</td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {r.min_stock}
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-3 text-slate-400">
                      No devices.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}