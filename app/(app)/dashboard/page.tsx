"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Row = { device: string; in_stock: number; out_stock: number; total: number };
type Resp = { ok: boolean; error?: string; per_device?: Row[] };

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setData({ ok: false, error: "Please sign in first." });
        return;
      }

      const res = await fetch("/api/dashboard/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as Resp;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data?.per_device || [])
    .filter((r) => {
      const qq = q.trim().toLowerCase();
      if (!qq) return true;
      return String(r.device ?? "").toLowerCase().includes(qq);
    })
    .sort((a, b) => (b.in_stock ?? 0) - (a.in_stock ?? 0));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Overview</div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-400 mt-1">Current stock by device (IN / OUT / TOTAL).</p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <div className="text-sm font-semibold">Stock summary</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter device…"
            className="w-full md:w-[280px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        {!data ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : !data.ok ? (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {data.error || "Dashboard error"}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-right p-2 border-b border-slate-800">IN</th>
                  <th className="text-right p-2 border-b border-slate-800">OUT</th>
                  <th className="text-right p-2 border-b border-slate-800">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.device} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800 font-semibold">{r.device || "UNKNOWN"}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{Number(r.in_stock ?? 0)}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{Number(r.out_stock ?? 0)}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{Number(r.total ?? 0)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="p-3 text-sm text-slate-400" colSpan={4}>
                      No rows.
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
