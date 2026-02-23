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

      // Transform API data → simplified dashboard format
      const mapped: Row[] = (json.rows || []).map((r: any) => ({
        device_id: r.device_id,
        device: r.device,
        canonical_name: r.canonical_name,
        imeis: r.imeis,
        boxes: r.boxes,
        floors: r.floors || [], // ⚠️ on adapte API après
        low_stock: r.low_stock,
      }));

      setRows(mapped);
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
        <h2 className="text-xl font-semibold">Warehouse overview</h2>
        <p className="text-sm text-slate-400 mt-1">
          Vue simple par device.
        </p>
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
                  <th className="text-right p-2 border-b border-slate-800">Boxes</th>
                  <th className="text-right p-2 border-b border-slate-800">IMEIs</th>
                  <th className="text-left p-2 border-b border-slate-800">Floor(s)</th>
                  <th className="text-right p-2 border-b border-slate-800">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.device_id} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800 font-semibold">
                      {r.device}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {r.boxes}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {r.imeis}
                    </td>
                    <td className="p-2 border-b border-slate-800">
                      {r.floors.length > 0
                        ? r.floors.join(", ")
                        : "—"}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {r.imeis === 0 ? (
                        <span className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2 py-1 text-xs font-semibold text-rose-200">
                          OUT
                        </span>
                      ) : r.low_stock ? (
                        <span className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-2 py-1 text-xs font-semibold text-amber-200">
                          LOW
                        </span>
                      ) : (
                        <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-2 py-1 text-xs font-semibold text-emerald-200">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-slate-400">
                      No devices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}