"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type SummaryResp = {
  ok: boolean;
  error?: string;
  per_device?: Array<{ device: string; in_stock: number; out_stock: number; total: number }>;
};

type ThresholdRow = { device: string; min_stock: number };

export default function AlertsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deviceFilter, setDeviceFilter] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      // 1) Dashboard summary (stock actuel)
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setSummary({ ok: false, error: "Please sign in first." });
        return;
      }

      const sRes = await fetch("/api/dashboard/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const sJson = (await sRes.json()) as SummaryResp;
      setSummary(sJson);

      // 2) Global thresholds
      const { data, error } = await supabase
        .from("device_thresholds")
        .select("device, min_stock");

      if (error) throw error;

      const map: Record<string, number> = {};
      (data || []).forEach((r: ThresholdRow) => {
        map[r.device] = Number(r.min_stock ?? 0);
      });
      setThresholds(map);
      setDraft({});
    } catch (e: any) {
      toast({ kind: "error", title: "Load failed", message: e?.message ?? "Error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = Array.isArray(summary?.per_device) ? summary!.per_device! : [];
  const q = deviceFilter.trim().toLowerCase();

  const filtered = rows.filter((r) => (!q ? true : String(r.device ?? "").toLowerCase().includes(q)));

  const enriched = filtered
    .map((r) => {
      const min = thresholds[r.device] ?? 0;
      const inStock = Number(r.in_stock ?? 0);
      const status = inStock <= min ? "ALERT" : "OK";
      return { ...r, min, status };
    })
    .sort((a, b) => {
      // ALERT en haut
      if (a.status !== b.status) return a.status === "ALERT" ? -1 : 1;
      // puis stock asc
      return (a.in_stock ?? 0) - (b.in_stock ?? 0);
    });

  async function saveMin(device: string) {
    const raw = draft[device];
    const val = Math.max(0, Number(raw ?? thresholds[device] ?? 0));

    try {
      const { error } = await supabase.from("device_thresholds").upsert(
        { device, min_stock: val },
        { onConflict: "device" }
      );
      if (error) throw error;

      setThresholds((m) => ({ ...m, [device]: val }));
      setDraft((d) => {
        const copy = { ...d };
        delete copy[device];
        return copy;
      });

      toast({ kind: "success", title: "Saved", message: `${device} min stock = ${val}` });
    } catch (e: any) {
      toast({
        kind: "error",
        title: "Save failed",
        message: e?.message ?? "Check admin rights / RLS policy",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Monitoring</div>
          <h2 className="text-xl font-semibold">🚨 Stock Alerts</h2>
          <p className="text-sm text-slate-400 mt-1">
            Global min stock thresholds (shared). Alerts when in_stock ≤ min_stock.
          </p>
        </div>

        <button
          onClick={loadAll}
          disabled={loading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!summary ? null : summary.ok ? (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
            <div className="text-sm font-semibold">Devices</div>
            <input
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              placeholder="Filter device…"
              className="w-full md:w-[280px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-right p-2 border-b border-slate-800">In stock</th>
                  <th className="text-right p-2 border-b border-slate-800">Min stock</th>
                  <th className="text-left p-2 border-b border-slate-800">Status</th>
                  <th className="text-right p-2 border-b border-slate-800">Action</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((r) => {
                  const isAlert = r.status === "ALERT";
                  const currentDraft = draft[r.device];
                  return (
                    <tr key={r.device} className={isAlert ? "bg-rose-950/30" : "hover:bg-slate-950/40"}>
                      <td className="p-2 border-b border-slate-800">{r.device || "UNKNOWN"}</td>
                      <td className="p-2 border-b border-slate-800 text-right font-semibold">
                        {Number(r.in_stock ?? 0)}
                      </td>
                      <td className="p-2 border-b border-slate-800 text-right">
                        <input
                          value={currentDraft ?? String(r.min)}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [r.device]: e.target.value.replace(/[^\d]/g, "") }))
                          }
                          className="w-[90px] text-right border border-slate-800 bg-slate-950 text-slate-100 rounded-lg px-2 py-1"
                        />
                      </td>
                      <td className="p-2 border-b border-slate-800">
                        <span
                          className={`inline-flex rounded-lg border px-2 py-1 text-xs font-semibold ${
                            isAlert
                              ? "border-rose-900/60 bg-rose-950/40 text-rose-200"
                              : "border-emerald-900/60 bg-emerald-950/40 text-emerald-200"
                          }`}
                        >
                          {isAlert ? "⚠️ LOW" : "✅ OK"}
                        </span>
                      </td>
                      <td className="p-2 border-b border-slate-800 text-right">
                        <button
                          onClick={() => saveMin(r.device)}
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {enriched.length === 0 && (
                  <tr>
                    <td className="p-3 text-sm text-slate-400" colSpan={5}>
                      No devices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Note: editing requires admin rights (RLS). If Save fails, add your user as admin in <code>user_roles</code>.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {summary.error || "Alerts error"}
        </div>
      )}
    </div>
  );
}
