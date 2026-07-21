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
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Monitoring</div>
          <h1 className="sp-title">🚨 Stock Alerts</h1>
          <p className="sp-desc">
            Global min stock thresholds (shared). Alerts when in_stock ≤ min_stock.
          </p>
        </div>

        <button
          onClick={loadAll}
          disabled={loading}
          className="sp-btn sp-btn-ghost"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!summary ? null : summary.ok ? (
        <div className="sp-card space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
            <div className="font-semibold text-sp-text">Devices</div>
            <input
              value={deviceFilter}
              onChange={(e) => setDeviceFilter(e.target.value)}
              placeholder="Filter device…"
              className="sp-input md:w-[280px]"
            />
          </div>

          <div className="sp-card sp-card-flush">
            <div className="overflow-x-auto">
              <table className="sp-table">
                <thead>
                <tr>
                  <th>Device</th>
                  <th className="text-right">In stock</th>
                  <th className="text-right">Min stock</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((r) => {
                  const isAlert = r.status === "ALERT";
                  const currentDraft = draft[r.device];
                  return (
                    <tr key={r.device}>
                      <td>{r.device || "UNKNOWN"}</td>
                      <td className="text-right font-semibold">
                        {Number(r.in_stock ?? 0)}
                      </td>
                      <td className="text-right">
                        <input
                          value={currentDraft ?? String(r.min)}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [r.device]: e.target.value.replace(/[^\d]/g, "") }))
                          }
                          className="sp-input w-[90px] text-right"
                        />
                      </td>
                      <td>
                        <span className={`sp-badge ${isAlert ? "sp-badge-low" : "sp-badge-ok"}`}>
                          {isAlert ? "⚠️ LOW" : "✅ OK"}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => saveMin(r.device)}
                          className="sp-btn sp-btn-ghost"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {enriched.length === 0 && (
                  <tr>
                    <td className="sp-desc" colSpan={5}>
                      No devices.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <div className="text-xs text-sp-muted">
            Note: editing requires admin rights (RLS). If Save fails, add your user as admin in <code>user_roles</code>.
          </div>
        </div>
      ) : (
        <div className="sp-alert sp-alert-err">
          {summary.error || "Alerts error"}
        </div>
      )}
    </div>
  );
}
