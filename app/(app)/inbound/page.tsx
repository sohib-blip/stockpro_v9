"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";
type HistoryFilter = "all" | "excel" | "manual";

type HistoryRow = {
  batch_id: string;
  created_at: string;
  actor: string;
  vendor: string;
  source: string;
  qty_boxes: number;
  qty_imeis: number;
};

type DeviceRow = {
  device_id: string;
  device: string;
};

function normName(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState<string>("");

  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

  const [lastBatchId, setLastBatchId] = useState<string>("");

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [binNameToId, setBinNameToId] = useState<Record<string, string>>({});

  const LABEL_W = 100;
  const LABEL_H = 50;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setActor(data.user.email);
      if (data?.user?.id) setActorId(data.user.id);
    })();
  }, [supabase]);

  async function loadDevices() {
    const { data } = await supabase
      .from("bins")
      .select("id, name, active")
      .eq("active", true)
      .order("name", { ascending: true });

    const list = (data as any) || [];

    setDevices(
      list.map((b: any) => ({
        device_id: String(b.id),
        device: String(b.name),
      }))
    );

    const map: Record<string, string> = {};
    for (const b of list) map[normName(b.name)] = String(b.id);
    setBinNameToId(map);
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/inbound/history", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setHistory(json.rows || []);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadDevices();
    loadHistory();
  }, []);

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  async function parseExcel() {
    setErr("");
    setResult(null);
    setLastBatchId("");

    if (!file) return setErr("Choose a file.");

    setBusy(true);

    try {
      const { data: bins } = await supabase
        .from("bins")
        .select("id, name, active")
        .eq("active", true);

      const map: Record<string, string> = {};
      for (const b of (bins as any[]) || []) {
        map[normName(b.name)] = String(b.id);
      }
      setBinNameToId(map);

      const fakeDevices = ((bins as any[]) || []).map((b) => ({
        device_id: b.id,
        canonical_name: b.name,
        device: b.name,
        active: true,
        units_per_imei: 1,
      }));

      const deviceMatches = toDeviceMatchList(fakeDevices as any);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseVendorExcel(vendor, bytes, deviceMatches);

      if (!parsed?.ok) {
        setErr(parsed?.error || "Parse failed");
        return;
      }

      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message || "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExcelInbound() {
    if (!result?.ok) return;

    setBusy(true);
    setErr("");

    try {
      const labelsConverted = (result.labels || []).map((l: any) => ({
        device_id: binNameToId[normName(l.device)] || "",
        box_no: l.box_no,
        floor,
        imeis: l.imeis,
      }));

      const res = await fetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: labelsConverted, actor, actor_id: actorId, vendor }),
      });

      const json = await res.json();
      if (!json.ok) throw new Error(json.error);

      setLastBatchId(json.batch_id);
      setResult(null);
      setFile(null);

      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const filteredHistory = history.filter((h) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "manual") return h.vendor?.toLowerCase() === "manual";
    return h.vendor?.toLowerCase() !== "manual";
  });

  return (
    <div className="relative space-y-8 max-w-5xl">

      {busy && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center rounded-2xl">
          <div className="bg-slate-900 border border-slate-700 px-6 py-4 rounded-xl text-center">
            <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full mx-auto mb-3" />
            <div className="text-sm">Importing… please wait</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Inbound Import</h2>
          <p className="text-sm text-slate-400 mt-1">
            User: <b>{actor}</b>
          </p>
        </div>

        {lastBatchId && (
          <a
            href={`/api/inbound/labels?batch_id=${lastBatchId}&w_mm=${LABEL_W}&h_mm=${LABEL_H}`}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
          >
            Download QR labels
          </a>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="font-semibold">Excel Import</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="teltonika">Teltonika</option>
            <option value="quicklink">Quicklink</option>
            <option value="digitalmatter">Digital Matter</option>
            <option value="truster">Truster</option>
          </select>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>

          <button
            onClick={parseExcel}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Preview import
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}

        {result?.ok && (
          <div className="flex justify-end">
            <button
              onClick={confirmExcelInbound}
              disabled={busy}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Confirm Inbound
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Inbound history</div>
          <button
            onClick={loadHistory}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold"
          >
            {loadingHistory ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 text-left">Date/Time</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Vendor</th>
              <th className="p-2 text-right">Boxes</th>
              <th className="p-2 text-right">IMEIs</th>
              <th className="p-2 text-right">Excel</th>
              <th className="p-2 text-right">Labels</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((h) => (
              <tr key={h.batch_id}>
                <td className="p-2">{fmtDateTime(h.created_at)}</td>
                <td className="p-2">{h.actor}</td>
                <td className="p-2">{h.vendor}</td>
                <td className="p-2 text-right font-semibold">{h.qty_boxes}</td>
                <td className="p-2 text-right font-semibold">{h.qty_imeis}</td>
                <td className="p-2 text-right">
                  <a href={`/api/inbound/export?batch_id=${h.batch_id}`} className="text-xs underline">
                    Excel
                  </a>
                </td>
                <td className="p-2 text-right">
                  <a href={`/api/inbound/labels?batch_id=${h.batch_id}&w_mm=100&h_mm=50`} className="text-xs underline">
                    PDF
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}