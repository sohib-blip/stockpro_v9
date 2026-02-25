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
  qty: number;
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

  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [lastBatchId, setLastBatchId] = useState("");

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [binNameToId, setBinNameToId] = useState<Record<string, string>>({});

  const LABEL_W = 100;
  const LABEL_H = 50;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setActor(data.user.email);
    })();
  }, [supabase]);

  async function loadDevices() {
    const { data } = await supabase
      .from("bins")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true });

    const list = (data as any[]) || [];

    setDevices(
      list.map((b) => ({
        device_id: String(b.id),
        device: String(b.name),
      }))
    );

    const map: Record<string, string> = {};
    list.forEach((b) => {
      map[normName(b.name)] = String(b.id);
    });

    setBinNameToId(map);
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/inbound/history", { cache: "no-store" });
      const json = await res.json();
      setHistory(json.ok ? json.rows : []);
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

  // ================= EXCEL =================

  async function parseExcel() {
    if (!file) return setErr("Choose a file.");

    setErr("");
    setResult(null);
    setBusy(true);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      const fakeDevices = devices.map((d) => ({
        device_id: d.device_id,
        canonical_name: d.device,
        device: d.device,
        active: true,
        units_per_imei: 1,
      }));

      const parsed = parseVendorExcel(
        vendor,
        bytes,
        toDeviceMatchList(fakeDevices as any)
      );

      if (parsed?.ok) {
        parsed.labels = parsed.labels.map((l: any) => ({
          ...l,
          floor,
        }));

        const devicesFound = new Set<string>();
        const boxAgg: Record<string, { imeis: number; device: string }> = {};
        const unknownBins: string[] = [];

        for (const l of parsed.labels || []) {
          const deviceName = String(l.device || "").trim();
          const boxNo = String(l.box_no || "").trim();
          const imeiCount = l.imeis?.length || 0;

          if (deviceName) devicesFound.add(deviceName);

          if (deviceName && !binNameToId[normName(deviceName)]) {
            unknownBins.push(deviceName);
          }

          if (boxNo) {
            if (!boxAgg[boxNo]) {
              boxAgg[boxNo] = { imeis: 0, device: deviceName };
            }
            boxAgg[boxNo].imeis += imeiCount;
          }
        }

        (parsed as any).devices_found = Array.from(devicesFound);
(parsed as any).unknown_bins_preview = Array.from(new Set(unknownBins));
(parsed as any).box_breakdown = Object.entries(boxAgg).map(
  ([box_no, v]) => ({
    box_no,
    imeis: v.imeis,
    device: v.device,
  })
);
      }

      setResult(parsed);
    } catch (e: any) {
      setErr(e.message || "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExcelInbound() {
    if (!result?.ok) return;

    if ((result?.unknown_bins_preview?.length ?? 0) > 0) {
      setErr("Import blocked: unknown bins detected.");
      return;
    }

    const labelsConverted = result.labels.map((l: any) => ({
      device: binNameToId[normName(l.device)],
      box_no: l.box_no,
      floor: l.floor,
      imeis: l.imeis,
    }));

    setBusy(true);

    try {
      const res = await fetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: labelsConverted, actor, vendor }),
      });

      const json = await res.json();

      if (!json.ok) throw new Error(json.error);

      setLastBatchId(json.batch_id);
      setResult(null);
      setFile(null);

      await loadHistory();
    } catch (e: any) {
      setErr(e.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const excelTotals = result?.ok
    ? {
        boxes: result.labels.length,
        imeis: result.labels.reduce(
          (a: number, l: any) => a + (l.imeis?.length || 0),
          0
        ),
      }
    : { boxes: 0, imeis: 0 };

  const filteredHistory = history.filter((h) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "manual")
      return h.vendor.toLowerCase() === "manual";
    return h.vendor.toLowerCase() !== "manual";
  });

  return (
    <div className="space-y-8 max-w-5xl">

      {/* HEADER */}
      <div className="flex justify-between">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Inbound Import</h2>
          <p className="text-sm text-slate-400">
            User: <b>{actor}</b>
          </p>
        </div>

        {lastBatchId && (
          <a
            href={`/api/inbound/labels?batch_id=${encodeURIComponent(
              lastBatchId
            )}&w_mm=${LABEL_W}&h_mm=${LABEL_H}`}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold"
          >
            Download QR labels
          </a>
        )}
      </div>

      {/* EXCEL */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="grid md:grid-cols-4 gap-3">
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="rounded-xl bg-slate-950 px-3 py-2"
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
            className="rounded-xl bg-slate-950 px-3 py-2"
          />

          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="rounded-xl bg-slate-950 px-3 py-2"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>

          <button
            onClick={parseExcel}
            disabled={busy}
            className="rounded-xl bg-indigo-600 px-4 py-2 font-semibold"
          >
            Preview import
          </button>
        </div>

        {err && (
          <div className="text-rose-400 text-sm">
            {err}
          </div>
        )}
      </div>

      {/* PREVIEW */}
      {result?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="font-semibold">
            Preview: {excelTotals.boxes} boxes • {excelTotals.imeis} IMEIs
          </div>

          <button
            onClick={confirmExcelInbound}
            disabled={busy || (result?.unknown_bins_preview?.length ?? 0) > 0}
            className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold"
          >
            Confirm Inbound
          </button>
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex justify-between">
          <div className="font-semibold">Inbound history</div>
          <select
            value={historyFilter}
            onChange={(e) =>
              setHistoryFilter(e.target.value as HistoryFilter)
            }
            className="rounded-xl bg-slate-950 px-3 py-2"
          >
            <option value="all">All</option>
            <option value="excel">Excel</option>
            <option value="manual">Manual</option>
          </select>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {filteredHistory.map((h) => (
              <tr key={h.batch_id}>
                <td>{fmtDateTime(h.created_at)}</td>
                <td>{h.actor}</td>
                <td>{h.vendor}</td>
                <td>{h.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}