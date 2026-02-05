"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { exportInStockByDevice } from "@/lib/exports";

type PerDeviceRow = { device: string; in_stock: number; out_stock: number; total: number };
type PerLocationRow = { location: "00" | "1" | "6" | "Cabinet" | "UNKNOWN"; in_stock: number };
type PerDeviceLocationRow = {
  device: string;
  total_in: number;
  locations: Array<{ location: "00" | "1" | "6" | "Cabinet" | "UNKNOWN"; in_stock: number }>;
};

type SummaryResp = {
  ok: boolean;
  error?: string;
  counts?: { devices?: number; items_in?: number; items_out?: number; boxes?: number };
  per_device?: PerDeviceRow[];

  // ✅ new
  per_location?: PerLocationRow[];
  per_device_location?: PerDeviceLocationRow[];
};

type ThresholdRow = { device: string; min_stock: number };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryResp | null>(null);

  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [deviceQuery, setDeviceQuery] = useState<string>("");

  const [sort, setSort] = useState<{ key: "device" | "in" | "out" | "total"; dir: "asc" | "desc" }>({
    key: "device",
    dir: "asc",
  });

  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [canExport, setCanExport] = useState(false);

  async function load() {
    setLoading(true);
    setSummary(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setSummary({ ok: false, error: "Please sign in first." });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/dashboard/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as SummaryResp;
      setSummary(json);

      const { data: tData, error: tErr } = await supabase.from("device_thresholds").select("device, min_stock");
      if (tErr) {
        toast({ kind: "error", title: "Thresholds not loaded", message: tErr.message });
        setThresholds({});
      } else {
        const map: Record<string, number> = {};
        (tData || []).forEach((r: ThresholdRow) => {
          map[String(r.device)] = Number(r.min_stock ?? 0);
        });
        setThresholds(map);
      }

      const { data: u } = await supabase.auth.getUser();
      if (u.user?.id) {
        const { data: p } = await supabase
          .from("user_permissions")
          .select("can_export")
          .eq("user_id", u.user.id)
          .maybeSingle();
        setCanExport(!!p?.can_export);
      }
    } catch (e: any) {
      setSummary({ ok: false, error: e?.message ?? "Dashboard error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setPage(1), [deviceQuery, sort.key, sort.dir]);

  const counts = summary?.counts || {};
  const perDeviceAll = Array.isArray(summary?.per_device) ? summary!.per_device! : [];
  const perLocation = Array.isArray(summary?.per_location) ? summary!.per_location! : [];
  const perDeviceLoc = Array.isArray(summary?.per_device_location) ? summary!.per_device_location! : [];

  const q = deviceQuery.trim().toLowerCase();

  const filtered = useMemo(() => {
    return perDeviceAll.filter((r) => (!q ? true : String(r.device ?? "").toLowerCase().includes(q)));
  }, [perDeviceAll, q]);

  const filteredTotals = useMemo(() => {
    const devices = filtered.length;
    const items_in = filtered.reduce((acc, r) => acc + Number(r.in_stock ?? 0), 0);
    const items_out = filtered.reduce((acc, r) => acc + Number(r.out_stock ?? 0), 0);
    const total = filtered.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
    return { devices, items_in, items_out, total };
  }, [filtered]);

  const useFilteredStats = q.length > 0;

  const devicesCount = useFilteredStats ? filteredTotals.devices : (counts.devices ?? 0);
  const inStock = useFilteredStats ? filteredTotals.items_in : (counts.items_in ?? 0);
  const outStock = useFilteredStats ? filteredTotals.items_out : (counts.items_out ?? 0);
  const totalItems = useFilteredStats ? filteredTotals.total : ((counts.items_in ?? 0) + (counts.items_out ?? 0));

  function isLow(device: string, in_stock: number) {
    const min = thresholds[device] ?? 0;
    return Number(in_stock ?? 0) <= Number(min);
  }

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const va =
        sort.key === "device"
          ? String(a.device ?? "")
          : sort.key === "in"
          ? a.in_stock ?? 0
          : sort.key === "out"
          ? a.out_stock ?? 0
          : a.total ?? 0;

      const vb =
        sort.key === "device"
          ? String(b.device ?? "")
          : sort.key === "in"
          ? b.in_stock ?? 0
          : sort.key === "out"
          ? b.out_stock ?? 0
          : b.total ?? 0;

      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
    return rows;
  }, [filtered, sort.key, sort.dir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const perDevice = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ✅ Devices x locations table (filter too)
  const perDeviceLocFiltered = useMemo(() => {
    if (!q) return perDeviceLoc;
    return perDeviceLoc.filter((r) => String(r.device ?? "").toLowerCase().includes(q));
  }, [perDeviceLoc, q]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Overview</div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-sm text-slate-400 mt-1">Devices + stock in / out + totals + locations.</p>
        </div>

        <div className="flex items-center gap-2">
          {canExport ? (
            <>
              <button
                onClick={() => exportFullInventory(supabase, toast)}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Export inventory CSV
              </button>
              <button
                onClick={() => exportInStockByDevice(supabase, toast)}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Export IN stock (device/box/IMEI)
              </button>
            </>
          ) : null}

          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!summary ? null : summary.ok ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Devices" value={devicesCount} />
            <Stat label="In stock" value={inStock} />
            <Stat label="Out stock" value={outStock} />
            <Stat label="Total items" value={totalItems} />
          </div>

          {/* ✅ Stock par étage */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="text-sm font-semibold">In stock par étage</div>
            <div className="text-xs text-slate-500 mt-1">00 / 1 / 6 / Cabinet.</div>

            <div className="overflow-auto mt-3">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="p-2 text-left border-b border-slate-800">Étage</th>
                    <th className="p-2 text-right border-b border-slate-800">IN</th>
                  </tr>
                </thead>
                <tbody>
                  {perLocation.map((r) => (
                    <tr key={r.location} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800">{r.location}</td>
                      <td className="p-2 border-b border-slate-800 text-right font-semibold">{r.in_stock}</td>
                    </tr>
                  ))}
                  {perLocation.length === 0 && (
                    <tr>
                      <td className="p-3 text-slate-400" colSpan={2}>
                        No location data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Devices list */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold">Devices</div>
                <div className="text-xs text-slate-500">IN / OUT / total per device.</div>
              </div>

              <input
                value={deviceQuery}
                onChange={(e) => setDeviceQuery(e.target.value)}
                placeholder="Filter by device name…"
                className="w-full md:w-[280px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
              />
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <Th label="Device" active={sort.key === "device"} dir={sort.dir} onClick={() => toggleSort(setSort, "device")} align="left" />
                    <Th label="IN" active={sort.key === "in"} dir={sort.dir} onClick={() => toggleSort(setSort, "in")} align="right" />
                    <Th label="OUT" active={sort.key === "out"} dir={sort.dir} onClick={() => toggleSort(setSort, "out")} align="right" />
                    <Th label="Total" active={sort.key === "total"} dir={sort.dir} onClick={() => toggleSort(setSort, "total")} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {perDevice.map((r) => {
                    const dev = r.device || "UNKNOWN";
                    const low = dev !== "UNKNOWN" ? isLow(dev, Number(r.in_stock ?? 0)) : false;

                    return (
                      <tr key={dev} className={low ? "bg-rose-950/20 hover:bg-rose-950/30" : "hover:bg-slate-950/50"}>
                        <td className="p-2 border-b border-slate-800">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-100">{dev}</span>
                            {low ? <LowBadge /> : null}
                          </div>
                          {dev !== "UNKNOWN" ? (
                            <div className="text-xs text-slate-500 mt-0.5">
                              Min stock: <span className="text-slate-300 font-semibold">{thresholds[dev] ?? 0}</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2 border-b border-slate-800 text-right">
                          <Badge kind="in">{r.in_stock ?? 0}</Badge>
                        </td>
                        <td className="p-2 border-b border-slate-800 text-right">
                          <Badge kind="out">{r.out_stock ?? 0}</Badge>
                        </td>
                        <td className="p-2 border-b border-slate-800 text-right text-slate-200">{r.total ?? 0}</td>
                      </tr>
                    );
                  })}
                  {perDevice.length === 0 && (
                    <tr>
                      <td className="p-3 text-sm text-slate-400" colSpan={4}>
                        No devices found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                  disabled={safePage === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <div className="text-xs text-slate-400">
                  Page {safePage} / {totalPages}
                </div>
                <button
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                  disabled={safePage === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* ✅ Device x étage */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="text-sm font-semibold">Devices par étage</div>
            <div className="text-xs text-slate-500 mt-1">IN stock (00 / 1 / 6 / Cabinet).</div>

            <div className="overflow-auto mt-3">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="p-2 text-left border-b border-slate-800">Device</th>
                    <th className="p-2 text-right border-b border-slate-800">00</th>
                    <th className="p-2 text-right border-b border-slate-800">1</th>
                    <th className="p-2 text-right border-b border-slate-800">6</th>
                    <th className="p-2 text-right border-b border-slate-800">Cabinet</th>
                    <th className="p-2 text-right border-b border-slate-800">Total IN</th>
                  </tr>
                </thead>
                <tbody>
                  {perDeviceLocFiltered.slice(0, 200).map((r) => {
                    const get = (loc: string) => r.locations.find((x) => x.location === loc)?.in_stock ?? 0;
                    return (
                      <tr key={r.device} className="hover:bg-slate-950/50">
                        <td className="p-2 border-b border-slate-800">{r.device}</td>
                        <td className="p-2 border-b border-slate-800 text-right">{get("00")}</td>
                        <td className="p-2 border-b border-slate-800 text-right">{get("1")}</td>
                        <td className="p-2 border-b border-slate-800 text-right">{get("6")}</td>
                        <td className="p-2 border-b border-slate-800 text-right">{get("Cabinet")}</td>
                        <td className="p-2 border-b border-slate-800 text-right font-semibold">{r.total_in}</td>
                      </tr>
                    );
                  })}
                  {perDeviceLocFiltered.length === 0 && (
                    <tr>
                      <td className="p-3 text-slate-400" colSpan={6}>
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500 mt-2">
              (Affichage limité à 200 lignes pour éviter lag.)
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {summary?.error || "Dashboard error"}
        </div>
      )}
    </div>
  );
}

function toggleSort(
  setSort: React.Dispatch<React.SetStateAction<{ key: "device" | "in" | "out" | "total"; dir: "asc" | "desc" }>>,
  key: "device" | "in" | "out" | "total"
) {
  setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
}

function Th({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align: "left" | "right";
}) {
  return (
    <th
      className={`select-none cursor-pointer ${align === "left" ? "text-left" : "text-right"} p-2 border-b border-slate-800 hover:bg-slate-950/60`}
      onClick={onClick}
      title="Sort"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? <span className="text-slate-500">{dir === "asc" ? "▲" : "▼"}</span> : null}
      </span>
    </th>
  );
}

function Badge({ kind, children }: { kind: "in" | "out"; children: React.ReactNode }) {
  const cls =
    kind === "in" ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-200" : "border-rose-900/60 bg-rose-950/40 text-rose-200";
  return <span className={`inline-flex min-w-[44px] justify-end rounded-lg border px-2 py-1 font-semibold ${cls}`}>{children}</span>;
}

function LowBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-[11px] font-bold text-rose-200">
      LOW STOCK
    </span>
  );
}

async function exportFullInventory(supabase: any, toast: (t: any) => void) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      toast({ kind: "error", title: "Export failed", message: "Please sign in first." });
      return;
    }

    const res = await fetch("/api/export/inventory", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let msg = "Export failed";
      try {
        const j = await res.json();
        msg = j?.error || msg;
      } catch {}
      toast({ kind: "error", title: "Export failed", message: msg });
      return;
    }

    const blob = await res.blob();
    const filename = getFilenameFromDisposition(res.headers.get("content-disposition")) || `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadBlob(filename, blob);
    toast({ kind: "success", title: "Inventory exported" });
  } catch (e: any) {
    toast({ kind: "error", title: "Export failed", message: e?.message || "Export failed" });
  }
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getFilenameFromDisposition(disposition: string | null) {
  if (!disposition) return null;
  const m = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"\n]+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1].replaceAll('"', "").trim());
}
