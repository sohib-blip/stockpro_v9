"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type StockRow = { device: string; boxes: number; items: number };
type ImportRow = { created_at: string; vendor: string | null; device: string | null; box_no: string | null; qty: number | null };
type MovementRow = { created_at: string; type: string | null; device: string | null; box_no: string | null; imei: string | null };

function safeStringArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const deviceFromUrl = String(searchParams.get("device") || "").trim();

  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string>("");

  const [devices, setDevices] = useState<string[]>([]);
  const [kpi, setKpi] = useState<{ devices: number; boxes: number; items: number }>({ devices: 0, boxes: 0, items: 0 });
  const [stock, setStock] = useState<StockRow[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  const [q, setQ] = useState("");
  const [deviceSelected, setDeviceSelected] = useState<string>(deviceFromUrl || "");

  useEffect(() => {
    setDeviceSelected(deviceFromUrl || "");
  }, [deviceFromUrl]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  function setDeviceInUrl(device: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (device) params.set("device", device);
    else params.delete("device");
    router.push(`?${params.toString()}`);
  }

  async function load() {
    setLastError("");
    try {
      setLoading(true);

      const token = await getAccessToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        setLastError("Pas connecté.");
        return;
      }

      const url = deviceSelected ? `/api/dashboard?device=${encodeURIComponent(deviceSelected)}` : "/api/dashboard";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        const msg = String(json?.error || `Dashboard fetch failed (${res.status})`);
        throw new Error(msg);
      }

      const devList = safeStringArray(json.devices);

      setDevices(devList);

      setKpi({
        devices: safeNumber(json?.kpi?.devices, 0),
        boxes: safeNumber(json?.kpi?.boxes, 0),
        items: safeNumber(json?.kpi?.items, 0),
      });

      const stockRows: StockRow[] = Array.isArray(json.stock)
        ? json.stock.map((s: any) => ({
            device: String(s?.device ?? ""),
            boxes: safeNumber(s?.boxes, 0),
            items: safeNumber(s?.items, 0),
          }))
        : [];

      setStock(stockRows);

      setImports(Array.isArray(json.imports) ? (json.imports as ImportRow[]) : []);
      setMovements(Array.isArray(json.movements) ? (json.movements as MovementRow[]) : []);
    } catch (e: any) {
      const msg = String(e?.message || "Error");
      setLastError(msg);
      toast({ kind: "error", title: "Dashboard", message: msg });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSelected]);

  const stockFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return stock;
    return stock.filter((s) => String(s.device || "").toLowerCase().includes(qq));
  }, [stock, q]);

  return (
    <div className="space-y-6">
      {/* HEADER + FILTER */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Dashboard</div>
          <h2 className="text-xl font-semibold">Stock overview</h2>
          <p className="text-sm text-slate-400 mt-1">Filtre par device + URL persistante.</p>
          {lastError ? (
            <div className="mt-2 text-xs text-rose-300">
              ⚠️ {lastError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search device…"
            className="border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm w-full md:w-[220px]"
          />

          <select
            value={deviceSelected}
            onChange={(e) => {
              const v = e.target.value;
              setDeviceSelected(v);
              setDeviceInUrl(v);
            }}
            className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm w-full md:w-[240px]"
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <button
            onClick={() => load()}
            disabled={loading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>

          <button
            onClick={() => {
              setQ("");
              setDeviceSelected("");
              setDeviceInUrl("");
            }}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard title="Devices" value={kpi.devices} />
        <StatCard title="Boxes" value={kpi.boxes} />
        <StatCard title="Items (IMEI)" value={kpi.items} />
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: STOCK TABLE */}
        <div className="lg:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Stock par device</div>
              <div className="text-xs text-slate-500">Boxes + Items (IMEI) calculés.</div>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-right p-2 border-b border-slate-800">Boxes</th>
                  <th className="text-right p-2 border-b border-slate-800">Items</th>
                </tr>
              </thead>
              <tbody>
                {stockFiltered.map((s) => (
                  <tr key={s.device} className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800 font-semibold text-slate-100">{s.device}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{s.boxes}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{s.items}</td>
                  </tr>
                ))}

                {stockFiltered.length === 0 && (
                  <tr>
                    <td className="p-3 text-sm text-slate-400" colSpan={3}>
                      No data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: IMPORTS + MOVEMENTS */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold">Derniers imports</div>
            <div className="text-xs text-slate-500">Bientôt (quand on relie les tables).</div>

            <div className="mt-2 space-y-2">
              {imports.length === 0 ? (
                <div className="text-xs text-slate-400">Aucun import.</div>
              ) : (
                imports.slice(0, 8).map((x, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs">
                    <div className="text-slate-200 font-semibold">
                      {x.device || "?"} · {x.box_no || "?"} · {x.qty ?? "?"} IMEI
                    </div>
                    <div className="text-slate-500">
                      {x.vendor || "vendor?"} · {formatDate(x.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold">Derniers mouvements</div>
            <div className="text-xs text-slate-500">Bientôt (quand on relie les tables).</div>

            <div className="mt-2 space-y-2">
              {movements.length === 0 ? (
                <div className="text-xs text-slate-400">Aucun mouvement.</div>
              ) : (
                movements.slice(0, 8).map((x, i) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs">
                    <div className="text-slate-200 font-semibold">
                      {x.type || "MOVE"} · {x.device || "?"} · {x.box_no || "?"}
                    </div>
                    <div className="text-slate-500">
                      {x.imei ? `IMEI: ${x.imei}` : "IMEI: —"} · {formatDate(x.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: any }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-2xl font-semibold text-slate-100 mt-1">{String(value)}</div>
    </div>
  );
}

function formatDate(v: any) {
  const s = String(v || "");
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}