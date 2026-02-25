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
  qty: number;
};

type DeviceRow = {
  device_id: string; // (on garde le nom pour pas toucher le UI)
  device: string; // label affiché
};

function normName(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");

  // Excel import
  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  // History
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

  // Labels after confirm
  const [lastBatchId, setLastBatchId] = useState<string>("");

  // Devices list (for manual dropdown) => NOW BINS
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  // ✅ Map "bin name" -> "bin id" (used for Excel confirm)
  const [binNameToId, setBinNameToId] = useState<Record<string, string>>({});

  // Manual import
  const [manualDevice, setManualDevice] = useState<string>(""); // NOW = bin_id
  const [manualBox, setManualBox] = useState<string>("");
  const [manualFloor, setManualFloor] = useState<string>("00");
  const [manualImeis, setManualImeis] = useState<string>("");

  const [manualPreview, setManualPreview] = useState<any>(null);
  const [manualMsg, setManualMsg] = useState<string>("");

  // Zebra label size (default 100x50mm)
  const LABEL_W = 100;
  const LABEL_H = 50;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadDevices() {
    // ✅ NEW SYSTEM: bins only
    const { data, error } = await supabase
      .from("bins")
      .select("id, name, active")
      .eq("active", true)
      .order("name", { ascending: true });

    if (!error) {
      const list = (data as any) || [];
      const mapped: DeviceRow[] = list.map((b: any) => ({
        device_id: String(b.id),
        device: String(b.name),
      }));
      setDevices(mapped);

      // ✅ map name -> id (case-insensitive)
      const map: Record<string, string> = {};
      for (const b of list) {
        map[normName(b.name)] = String(b.id);
      }
      setBinNameToId(map);

      if (!manualDevice && mapped.length > 0) {
        setManualDevice(mapped[0].device_id); // ✅ default = bin_id
      }
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/inbound/history", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setHistory(json.rows || []);
      else setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadHistory();
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  // ========== EXCEL FLOW ==========
  async function parseExcel() {
    setErr("");
    setResult(null);
    setLastBatchId("");
    setManualPreview(null);
    setManualMsg("");

    if (!file) return setErr("Choose a file.");

    setBusy(true);
    try {
      // ✅ NEW SYSTEM: bins
      const { data: bins, error: binsErr } = await supabase
        .from("bins")
        .select("id, name, active")
        .eq("active", true);

      if (binsErr) throw binsErr;

      // refresh map for Excel confirm
      const map: Record<string, string> = {};
      for (const b of (bins as any[]) || []) {
        map[normName(b.name)] = String(b.id);
      }
      setBinNameToId(map);

      // keep parser compatible
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

      if (parsed?.ok) {
        parsed.labels = parsed.labels.map((l: any) => ({
          ...l,
          floor,
        }));

        // ✅ NEW: Preview details (devices found + IMEIs per box)
        const devicesFound = new Set<string>();
        const boxMap: Record<string, number> = {};

        for (const l of parsed.labels || []) {
          const deviceName = String(l.device || "").trim();
          const boxNo = String(l.box_no || "").trim();
          const imeiCount = Array.isArray(l.imeis) ? l.imeis.length : 0;

          if (deviceName) devicesFound.add(deviceName);

          if (boxNo) {
            boxMap[boxNo] = (boxMap[boxNo] || 0) + imeiCount;
          }
        }

        // ✅ detect unknown bins directly in preview
const unknownBins: string[] = [];

for (const l of parsed.labels || []) {
  const deviceName = String(l.device || "").trim();
  const key = normName(deviceName);

  if (deviceName && !map[key]) {
    unknownBins.push(deviceName);
  }
}

(parsed as any).unknown_bins_preview = Array.from(new Set(unknownBins));

        // ✅ FIX TS: cast parsed to any
        (parsed as any).devices_found = Array.from(devicesFound);

        (parsed as any).box_breakdown = Object.entries(boxMap).map(([box_no, imeis]) => ({
          box_no,
          imeis,
        }));
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

    if (Array.isArray(result.unknown_devices) && result.unknown_devices.length > 0) {
      setErr(`Import blocked: unknown devices -> ${result.unknown_devices.join(", ")}`);
      return;
    }

    // ✅ convert label.device (name) -> bin_id
    const missingBins: string[] = [];
    const labelsConverted = (result.labels || []).map((l: any) => {
      const name = normName(l.device);
      const bin_id = binNameToId[name];

      if (!bin_id) missingBins.push(l.device);

      return {
        device: bin_id || "", // ✅ now contains bin_id
        box_no: l.box_no,
        floor: l.floor || floor,
        imeis: l.imeis,
      };
    });

    if (missingBins.length > 0) {
      setErr(`Import blocked: bins not found -> ${Array.from(new Set(missingBins)).join(", ")}`);
      return;
    }

    setBusy(true);
    setErr("");
    setManualMsg("");

    try {
      const payload = {
        labels: labelsConverted,
        actor,
        vendor,
      };

      const res = await fetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!json.ok) {
        if (json.unknown_devices?.length) {
          setErr(`Import blocked: unknown devices -> ${json.unknown_devices.join(", ")}`);
          return;
        }
        throw new Error(json.error || "Confirm failed");
      }

      setLastBatchId(json.batch_id);
      setResult(null);
      setFile(null);

      alert(
        `Inbound OK ✅\nInserted: ${json.totals.inserted_imeis}\nSkipped(existing): ${json.totals.skipped_existing_imeis}\nBoxes created: ${json.totals.created_boxes}\nBoxes reused: ${json.totals.reused_boxes}`
      );

      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const excelTotals = result?.ok
    ? {
        boxes: result.labels.length,
        imeis: result.labels.reduce((a: number, l: any) => a + (l.imeis?.length || 0), 0),
      }
    : { boxes: 0, imeis: 0 };

  const hasUnknownExcelDevices =
    result?.ok && Array.isArray(result.unknown_devices) && result.unknown_devices.length > 0;

  // ========== MANUAL FLOW ==========
  function extractManualImeis(text: string): string[] {
    const raw = text.split(/\s+/g).map((x) => x.trim()).filter(Boolean);
    const found: string[] = [];
    for (const token of raw) {
      const digits = token.replace(/\D/g, "");
      if (digits.length === 15) found.push(digits);
    }
    return Array.from(new Set(found));
  }

  async function previewManualImport() {
    setManualMsg("");
    setManualPreview(null);
    setLastBatchId("");
    setErr("");
    setResult(null);

    const imeis = extractManualImeis(manualImeis);

    if (!manualDevice) return setManualMsg("❌ Select a device.");
    if (!manualBox.trim()) return setManualMsg("❌ Enter box number.");
    if (imeis.length === 0) return setManualMsg("❌ No valid 15-digit IMEIs found.");

    setBusy(true);
    try {
      const res = await fetch("/api/inbound/manual-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: manualDevice, // ✅ bin_id
          box_no: manualBox.trim(),
          floor: manualFloor,
          imeis,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setManualMsg("❌ " + (json.error || "Manual preview failed"));
        return;
      }

      setManualPreview(json);
      setManualMsg("");
    } catch (e: any) {
      setManualMsg("❌ " + (e?.message || "Manual preview failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmManualImport() {
    setManualMsg("");

    if (!manualPreview?.ok) return setManualMsg("❌ No preview available.");

    const imeisToInsert: string[] = manualPreview.preview_imeis || [];
    if (imeisToInsert.length === 0) return setManualMsg("❌ Nothing to import (all duplicates?).");

    setBusy(true);
    try {
      const res = await fetch("/api/inbound/manual-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: manualDevice, // ✅ bin_id
          box_no: manualBox.trim(),
          floor: manualFloor,
          imeis: imeisToInsert,
          actor,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setManualMsg("❌ " + (json.error || "Manual confirm failed"));
        return;
      }

      if (json.inserted === 0) {
        setManualMsg(`⚠️ Nothing inserted. Skipped existing: ${json.skipped_existing || 0}`);
        setManualPreview(null);
        return;
      }

      setLastBatchId(json.batch_id);

      setManualPreview(null);
      setManualImeis("");
      setManualBox("");

      const skipped = json.skipped_existing || 0;
      setManualMsg(`✅ Manual inbound saved (${json.inserted} IMEIs). Skipped existing: ${skipped}`);

      await loadHistory();
    } catch (e: any) {
      setManualMsg("❌ " + (e?.message || "Manual confirm failed"));
    } finally {
      setBusy(false);
    }
  }

  // ========== HISTORY FILTER ==========
  const filteredHistory = history.filter((h) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "manual") return (h.vendor || "").toLowerCase() === "manual";
    return (h.vendor || "").toLowerCase() !== "manual";
  });

  return (
    <div className="space-y-8 max-w-5xl">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Inbound Import</h2>
          <p className="text-sm text-slate-400 mt-1">
            User: <b>{actor}</b>
          </p>
        </div>

        {lastBatchId && (
          <a
            href={`/api/inbound/labels?batch_id=${encodeURIComponent(lastBatchId)}&w_mm=${LABEL_W}&h_mm=${LABEL_H}`}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
          >
            Download QR labels (ZD220 PDF)
          </a>
        )}
      </div>

      {/* MANUAL IMPORT */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div>
          <div className="font-semibold">Manual Import</div>
          <div className="text-xs text-slate-500">
            Manual imports are included in history (vendor=manual) + Excel export + QR labels.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={manualDevice}
            onChange={(e) => setManualDevice(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            {devices.length === 0 && <option value="">No active devices found</option>}
            {devices.map((d) => (
              <option key={d.device_id} value={d.device_id}>
                {d.device}
              </option>
            ))}
          </select>

          <input
            placeholder="Box number"
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            value={manualBox}
            onChange={(e) => setManualBox(e.target.value)}
          />

          <select
            value={manualFloor}
            onChange={(e) => setManualFloor(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>
        </div>

        <textarea
          placeholder="Scan or paste IMEIs (one per line). Only 15-digit kept."
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
          value={manualImeis}
          onChange={(e) => setManualImeis(e.target.value)}
        />

        <div className="flex flex-wrap gap-2">
          <button
            onClick={previewManualImport}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Preview Manual Import
          </button>

          <button
            onClick={confirmManualImport}
            disabled={busy || !manualPreview?.ok}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Confirm Manual Import
          </button>
        </div>

        {manualMsg && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
            {manualMsg}
          </div>
        )}

        {manualPreview?.ok && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm space-y-2">
            <div className="font-semibold">Manual Preview</div>
            <div>
              Scanned: <b>{manualPreview.total_scanned}</b> • New: <b>{manualPreview.valid_new}</b> • Duplicates:{" "}
              <b>{manualPreview.duplicates}</b>
            </div>
          </div>
        )}
      </div>

      {/* EXCEL IMPORT */}
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
            {busy ? "Working…" : "Preview import"}
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}
      </div>

      {result?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">
              Preview: {excelTotals.boxes} boxes • {excelTotals.imeis} IMEIs

              {result?.devices_found?.length > 0 && (
                <div className="text-xs text-slate-400 mt-2">
                  <b>Devices detected:</b> {result.devices_found.join(", ")}
                </div>
              )}

{result?.unknown_bins_preview?.length > 0 && (
  <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200 mt-3">
    <div className="font-semibold">Unknown bins detected</div>
    <div className="mt-1">
      {result.unknown_bins_preview.join(", ")}
    </div>
  </div>
)}

              {result?.box_breakdown?.length > 0 && (
                <div className="mt-3 text-xs text-slate-400 space-y-1">
                  <b>Boxes detected:</b>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                    {result.box_breakdown.map((b: any) => (
                      <div key={b.box_no} className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1">
                        <span className="font-semibold">{b.box_no}</span>
                        <span className="ml-2 text-slate-500">{b.imeis} IMEIs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={confirmExcelInbound}
              disabled={busy || hasUnknownExcelDevices}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Confirm Inbound (Save)
            </button>
          </div>

          {hasUnknownExcelDevices && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200">
              <div className="font-semibold">Import blocked</div>
              <div className="mt-1">
                Unknown devices found: <b>{result.unknown_devices.join(", ")}</b>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Inbound history</div>
            <div className="text-xs text-slate-500">
              Filter Excel vs Manual, download Excel export + QR labels anytime.
            </div>
          </div>

          <div className="flex gap-2">
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="excel">Excel only</option>
              <option value="manual">Manual only</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 border-b border-slate-800 text-left">Date/Time</th>
                <th className="p-2 border-b border-slate-800 text-left">User</th>
                <th className="p-2 border-b border-slate-800 text-left">Vendor</th>
                <th className="p-2 border-b border-slate-800 text-right">Qty</th>
                <th className="p-2 border-b border-slate-800 text-right">Excel</th>
                <th className="p-2 border-b border-slate-800 text-right">Labels</th>
              </tr>
            </thead>

            <tbody>
              {filteredHistory.map((h) => (
                <tr key={h.batch_id} className="hover:bg-slate-950/40">
                  <td className="p-2 border-b border-slate-800">{fmtDateTime(h.created_at)}</td>
                  <td className="p-2 border-b border-slate-800">{h.actor}</td>
                  <td className="p-2 border-b border-slate-800">{h.vendor}</td>
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">{h.qty}</td>

                  <td className="p-2 border-b border-slate-800 text-right">
                    <a
                      href={`/api/inbound/export?batch_id=${encodeURIComponent(h.batch_id)}`}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                    >
                      Excel
                    </a>
                  </td>

                  <td className="p-2 border-b border-slate-800 text-right">
                    <a
                      href={`/api/inbound/labels?batch_id=${encodeURIComponent(h.batch_id)}&w_mm=100&h_mm=50`}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                    >
                      ZD220 PDF
                    </a>
                  </td>
                </tr>
              ))}

              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-slate-400">
                    No inbound batches for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}