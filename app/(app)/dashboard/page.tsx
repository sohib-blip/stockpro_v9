"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SummaryRow = {
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

type SummaryResponse =
  | {
      ok: true;
      totals: { devices: number; boxes: number; imeis: number; items: number; low: number };
      rows: SummaryRow[];
    }
  | { ok: false; error: string };

function Card({
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
      <div className="text-xs text-slate-400">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub ? <div className="text-xs text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const json = (await res.json()) as SummaryResponse;
      setData(json);
    } catch (e: any) {
      setData({ ok: false, error: e?.message || "Failed to fetch" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    if (!data || !("ok" in data) || !data.ok) return [];
    const qq = q.trim().toLowerCase();
    return data.rows
      .filter((r) => (onlyLow ? r.low_stock : true))
      .filter((r) => {
        if (!qq) return true;
        return (
          r.device.toLowerCase().includes(qq) ||
          r.canonical_name.toLowerCase().includes(qq)
        );
      })
      .sort((a, b) => Number(b.items) - Number(a.items));
  }, [data, q, onlyLow]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Dashboard</div>
          <h2 className="text-xl font-semibold">Stock overview</h2>
          <p className="text-sm text-slate-400 mt-1">
            Items = IMEI × Units/IMEI (config dans <b>Admin → Devices</b>).
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={load}
            className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Refresh
          </button>
          <Link
            href="/inbound"
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
          >
            Inbound
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">
          Loading…
        </div>
      ) : !data || !data.ok ? (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {(data as any)?.error || "Error"}
          <div className="text-xs text-rose-200/70 mt-2">
            Check Vercel env vars + Supabase tables (devices/items).
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card title="Devices" value={data.totals.devices} />
            <Card title="Boxes" value={data.totals.boxes} />
            <Card title="IMEIs" value={data.totals.imeis} />
            <Card title="Items" value={data.totals.items} sub={`${data.totals.low} low stock`} />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Stock by device</div>
                <div className="text-xs text-slate-500">
                  Quick view pour voir direct ce qui manque.
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search device…"
                  className="w-full md:w-[260px] rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setOnlyLow((v) => !v)}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                    onlyLow
                      ? "border-amber-500/40 bg-amber-950/30 hover:bg-amber-950/40"
                      : "border-slate-800 bg-slate-950 hover:bg-slate-800"
                  }`}
                >
                  {onlyLow ? "Low stock only ✓" : "Low stock only"}
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="text-left p-2 border-b border-slate-800">Device</th>
                    <th className="text-right p-2 border-b border-slate-800">Units/IMEI</th>
                    <th className="text-right p-2 border-b border-slate-800">IMEIs</th>
                    <th className="text-right p-2 border-b border-slate-800">Boxes</th>
                    <th className="text-right p-2 border-b border-slate-800">Items</th>
                    <th className="text-right p-2 border-b border-slate-800">Min</th>
                    <th className="text-right p-2 border-b border-slate-800">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.device_id} className="hover:bg-slate-950/40">
                      <td className="p-2 border-b border-slate-800">
                        <div className="font-semibold">{r.device}</div>
                        <div className="text-xs text-slate-500">{r.canonical_name}</div>
                      </td>
                      <td className="p-2 border-b border-slate-800 text-right">{r.units_per_imei}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{r.imeis}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{r.boxes}</td>
                      <td className="p-2 border-b border-slate-800 text-right font-semibold">
                        {r.items}
                      </td>
                      <td className="p-2 border-b border-slate-800 text-right">{r.min_stock}</td>
                      <td className="p-2 border-b border-slate-800 text-right">
                        {r.low_stock ? (
                          <span className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-2 py-1 text-xs font-semibold">
                            LOW
                          </span>
                        ) : (
                          <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-2 py-1 text-xs font-semibold">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-3 text-slate-400">
                        No results.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500">
              Next step: Outbound (scan) + mouvements stock + historique.
            </div>
          </div>
        </>
      )}
    </div>
  );
}