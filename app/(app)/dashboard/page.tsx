"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type ApiDeviceRow = {
  device_id: string;
  device: string;
  active: boolean;
  in: number;
  out: number;
  total: number;
};

type ApiLocationRow = {
  location: string;
  in: number;
};

type ApiResponse = {
  ok: true;
  stats: {
    devices: number;
    in_stock: number;
    out_stock: number;
    total_items: number;
  };
  in_stock_by_location: ApiLocationRow[];
  devices: ApiDeviceRow[];
  pagination: {
    q: string;
    page: number;
    limit: number;
    total_filtered: number;
  };
};

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const qFromUrl = String(searchParams.get("q") || "");
  const pageFromUrl = Math.max(1, Number(searchParams.get("page") || "1") || 1);

  const [loading, setLoading] = useState(false);

  const [stats, setStats] = useState<ApiResponse["stats"]>({
    devices: 0,
    in_stock: 0,
    out_stock: 0,
    total_items: 0,
  });

  const [inByLocation, setInByLocation] = useState<ApiLocationRow[]>([]);
  const [deviceRows, setDeviceRows] = useState<ApiDeviceRow[]>([]);
  const [pagination, setPagination] = useState<ApiResponse["pagination"]>({
    q: "",
    page: 1,
    limit: 25,
    total_filtered: 0,
  });

  const [q, setQ] = useState(qFromUrl);
  const [deviceFilter, setDeviceFilter] = useState<string>(String(searchParams.get("device") || ""));

  useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    setDeviceFilter(String(searchParams.get("device") || ""));
  }, [searchParams]);

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  function pushParams(next: { q?: string; page?: number; device?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    if (typeof next.q === "string") {
      const v = next.q.trim();
      if (v) params.set("q", v);
      else params.delete("q");
    }

    if (typeof next.device === "string") {
      const v = next.device.trim();
      if (v) params.set("device", v);
      else params.delete("device");
    }

    if (typeof next.page === "number") {
      if (next.page > 1) params.set("page", String(next.page));
      else params.delete("page");
    }

    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?");
  }

  async function load() {
    try {
      setLoading(true);

      const token = await getAccessToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      const params = new URLSearchParams();
      if (qFromUrl.trim()) params.set("q", qFromUrl.trim());
      params.set("page", String(pageFromUrl));
      params.set("limit", "25");

      const res = await fetch(`/api/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !json?.ok) throw new Error((json as any)?.error || "Dashboard fetch failed");

      setStats(json.stats);
      setInByLocation(json.in_stock_by_location || []);
      setDeviceRows(json.devices || []);
      setPagination(json.pagination);
    } catch (e: any) {
      toast({ kind: "error", title: "Dashboard", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFromUrl, pageFromUrl]);

  const deviceOptions = useMemo(() => {
    // dropdown = tous les devices (même si pagination ne montre qu’une page)
    // -> on prend ceux de la page + on garde le filtre actuel (sinon dropdown vide)
    const set = new Set<string>();
    for (const d of deviceRows) set.add(d.device);
    if (deviceFilter) set.add(deviceFilter);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deviceRows, deviceFilter]);

  const visibleDeviceRows = useMemo(() => {
    if (!deviceFilter) return deviceRows;
    return deviceRows.filter((d) => d.device === deviceFilter);
  }, [deviceRows, deviceFilter]);

  const totalPages = useMemo(() => {
    const total = pagination.total_filtered || 0;
    const lim = pagination.limit || 25;
    return Math.max(1, Math.ceil(total / lim));
  }, [pagination]);

  return (
    <div className="space-y-6">
      {/* HEADER + FILTER */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Dashboard</div>
          <h2 className="text-xl font-semibold">Stock overview</h2>
          <p className="text-sm text-slate-400 mt-1">Filtre par device + recherche + pagination.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search device…"
            className="border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm w-full md:w-[220px]"
          />

          <button
            onClick={() => pushParams({ q, page: 1 })}
            disabled={loading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Search"}
          </button>

          <select
            value={deviceFilter}
            onChange={(e) => pushParams({ device: e.target.value, page: 1 })}
            className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm w-full md:w-[240px]"
          >
            <option value="">All devices</option>
            {deviceOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <button
            onClick={() => pushParams({ q: "", device: "", page: 1 })}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard title="Devices" value={stats.devices} />
        <StatCard title="IN stock" value={stats.in_stock} />
        <StatCard title="OUT" value={stats.out_stock} />
        <StatCard title="Total items" value={stats.total_items} />
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: DEVICES TABLE */}
        <div className="lg:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Stock par device</div>
              <div className="text-xs text-slate-500">IN / OUT / Total (sur la page).</div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>
                Page {pagination.page} / {totalPages}
              </span>
              <button
                onClick={() => pushParams({ page: Math.max(1, pageFromUrl - 1) })}
                disabled={loading || pageFromUrl <= 1}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => pushParams({ page: Math.min(totalPages, pageFromUrl + 1) })}
                disabled={loading || pageFromUrl >= totalPages}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-right p-2 border-b border-slate-800">IN</th>
                  <th className="text-right p-2 border-b border-slate-800">OUT</th>
                  <th className="text-right p-2 border-b border-slate-800">Total</th>
                  <th className="text-right p-2 border-b border-slate-800">Active</th>
                </tr>
              </thead>
              <tbody>
                {visibleDeviceRows.map((d) => (
                  <tr key={d.device_id} className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800 font-semibold text-slate-100">{d.device}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{d.in}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{d.out}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{d.total}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{d.active ? "✅" : "—"}</td>
                  </tr>
                ))}

                {visibleDeviceRows.length === 0 && (
                  <tr>
                    <td className="p-3 text-sm text-slate-400" colSpan={5}>
                      No data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: LOCATION */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold">IN stock par étage</div>
            <div className="text-xs text-slate-500">Basé sur boxes.location + items IN.</div>
          </div>

          <div className="space-y-2">
            {inByLocation.length === 0 ? (
              <div className="text-xs text-slate-400">Aucune donnée.</div>
            ) : (
              inByLocation.map((x) => (
                <div key={x.location} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <div className="font-semibold text-slate-100">{x.location}</div>
                    <div className="text-slate-200">{x.in}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => load()}
            disabled={loading}
            className="w-full rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
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