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
  shipment_ref?: string;   // ✅ AJOUT
  qty_imeis: number;
  qty_boxes: number;
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
  const [actorId, setActorId] = useState<string>("");

  // Excel import
  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string>(""); // ✅ NEW (overlay text)
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  // History
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [search, setSearch] = useState("");
  const [shipmentRef, setShipmentRef] = useState("");
const [page, setPage] = useState(1);

  // Labels after confirm
  const [lastBatchId, setLastBatchId] = useState<string>("");

  // Devices list (for manual dropdown) => NOW BINS
  const [devices, setDevices] = useState<DeviceRow[]>([]);

  // Map "bin name" -> "bin id" (used for Excel confirm)
  const [binNameToId, setBinNameToId] = useState<Record<string, string>>({});

  // Manual import
  const [manualDevice, setManualDevice] = useState<string>(""); // NOW = bin_id
  const [manualBox, setManualBox] = useState<string>("");
  const [manualFloor, setManualFloor] = useState<string>("00");
  const [manualImeis, setManualImeis] = useState<string>("");

  const [manualPreview, setManualPreview] = useState<any>(null);
  const [manualReadyToImport, setManualReadyToImport] = useState(false);
  const [manualMsg, setManualMsg] = useState<string>("");

  // Zebra label size (default 105x155mm)
  const LABEL_W = 105;
  const LABEL_H = 155;

  function startBusy(text: string) {
    setBusy(true);
    setBusyText(text);
  }

  function stopBusy() {
    setBusy(false);
    setBusyText("");
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      const id = data?.user?.id;
      if (email) setActor(email);
      if (id) setActorId(id);
    })();
  }, [supabase]);

  async function loadDevices() {
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

      const map: Record<string, string> = {};
      for (const b of list) {
        map[normName(b.name)] = String(b.id);
      }
      setBinNameToId(map);

      if (!manualDevice && mapped.length > 0) {
        setManualDevice(mapped[0].device_id);
      }
    }
  }

  async function loadHistory() {
  setLoadingHistory(true);
  try {
    const res = await fetch(`/api/inbound/history?page=${page}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
      },
    });

    const json = await res.json();
    if (json.ok) setHistory(json.rows || []);
    else setHistory([]);
  } finally {
    setLoadingHistory(false);
  }
}

  useEffect(() => {
  loadHistory();
}, [page]);

useEffect(() => {
  loadDevices();
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

    startBusy("Préparation du preview…");
    try {
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

        // ✅ Preview details
        const devicesFound = new Set<string>();

        // box_no -> { imeisCount, deviceName }
        const boxAgg: Record<string, { imeis: number; device: string }> = {};

        for (const l of parsed.labels || []) {
          const deviceName = String(l.device || "").trim();
          const boxNo = String(l.box_no || "").trim();
          const imeiCount = Array.isArray(l.imeis) ? l.imeis.length : 0;

          if (deviceName) devicesFound.add(deviceName);

          if (boxNo) {
            if (!boxAgg[boxNo]) {
              boxAgg[boxNo] = { imeis: 0, device: deviceName || "" };
            }
            boxAgg[boxNo].imeis += imeiCount;

            // si jamais une même box apparait avec 2 devices différents
            if (deviceName && boxAgg[boxNo].device && boxAgg[boxNo].device !== deviceName) {
              boxAgg[boxNo].device = "MULTI";
            } else if (deviceName && !boxAgg[boxNo].device) {
              boxAgg[boxNo].device = deviceName;
            }
          }
        }

        // ✅ detect unknown bins directly in preview
        const unknownBins: string[] = [];
        for (const l of parsed.labels || []) {
          const deviceName = String(l.device || "").trim();
          const key = normName(deviceName);
          if (deviceName && !map[key]) unknownBins.push(deviceName);
        }

        (parsed as any).devices_found = Array.from(devicesFound);
        (parsed as any).unknown_bins_preview = Array.from(new Set(unknownBins));
        (parsed as any).box_breakdown = Object.entries(boxAgg)
          .map(([box_no, v]) => ({
            box_no,
            imeis: v.imeis,
            device: v.device,
          }))
          .sort((a, b) => a.box_no.localeCompare(b.box_no, undefined, { numeric: true }));
      }

      if (!parsed?.ok) {
        setErr(parsed?.error || "Parse failed");
        // eslint-disable-next-line no-console
        console.log("PARSE DEBUG:", parsed?.debug);
        return;
      }

      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message || "Parse failed");
    } finally {
      stopBusy();
    }
  }

  async function confirmExcelInbound() {
    if (!result?.ok) return;

    if (Array.isArray(result.unknown_devices) && result.unknown_devices.length > 0) {
      setErr(`Import blocked: unknown devices -> ${result.unknown_devices.join(", ")}`);
      return;
    }

    const missingBins: string[] = [];
    const labelsConverted = (result.labels || []).map((l: any) => {
      const name = normName(l.device);
      const bin_id = binNameToId[name];
      if (!bin_id) missingBins.push(l.device);

      return {
        device_id: bin_id || "",
        box_no: l.box_no,
        floor: l.floor || floor,
        imeis: l.imeis,
      };
    });

    if (missingBins.length > 0) {
      setErr(`Import blocked: bins not found -> ${Array.from(new Set(missingBins)).join(", ")}`);
      return;
    }

    startBusy("Import en cours…");
    setErr("");
    setManualMsg("");

    try {
      const payload = {
  labels: labelsConverted,
  actor,
  actor_id: actorId,
  vendor,
  shipment_ref: shipmentRef || null,
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

      // ✅ IMPORTANT: refresh history directly, no reload
      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      stopBusy();
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
    setManualReadyToImport(false);

    const imeis = extractManualImeis(manualImeis);

    if (!manualDevice) return setManualMsg("❌ Select a device.");
    if (!manualBox.trim()) return setManualMsg("❌ Enter box number.");
    if (imeis.length === 0) return setManualMsg("❌ No valid 15-digit IMEIs found.");

    startBusy("Préparation du preview manuel…");
    try {
      const res = await fetch("/api/inbound/manual-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: manualDevice,
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
setManualReadyToImport(true); // 🔥 AJOUTE ICI
setManualMsg("");
    } catch (e: any) {
      setManualMsg("❌ " + (e?.message || "Manual preview failed"));
    } finally {
      stopBusy();
    }
  }

  async function confirmManualImport() {
    setManualMsg("");

    if (!manualReadyToImport) {
    return setManualMsg("❌ Please preview before importing.");
  }

    if (!manualPreview?.ok) return setManualMsg("❌ No preview available.");

    const imeisToInsert: string[] = manualPreview.preview_imeis || [];
    if (imeisToInsert.length === 0) return setManualMsg("❌ Nothing to import (all duplicates?).");

    startBusy("Import manuel en cours…");
    try {
      const res = await fetch("/api/inbound/manual-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: manualDevice,
          box_no: manualBox.trim(),
          floor: manualFloor,
          imeis: imeisToInsert,
          actor,
          actor_id: actorId,
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

      // ✅ IMPORTANT: refresh history directly, no reload
      await loadHistory();
    } catch (e: any) {
      setManualMsg("❌ " + (e?.message || "Manual confirm failed"));
    } finally {
      stopBusy();
    }
  }

  // ========== HISTORY FILTER ==========
  const filteredHistory = history.filter((h) => {
  const vendor = (h.vendor || "").toLowerCase();
  const actor = (h.actor || "").toLowerCase();
  const ref = (h.shipment_ref || "").toLowerCase();
  const q = search.toLowerCase();

  const filterOk =
    historyFilter === "all" ||
    (historyFilter === "manual" && vendor === "manual") ||
    (historyFilter === "excel" && vendor !== "manual");

  const searchOk =
    !q ||
    actor.includes(q) ||
    vendor.includes(q) ||
    ref.includes(q);

  return filterOk && searchOk;
});

  return (
  <div className="space-y-8 w-full">
      {/* ✅ GLOBAL LOADER OVERLAY (no layout change, just overlay) */}
      {busy && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4">
          <div className="sp-card w-full max-w-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-sp-primary border-t-transparent" />
              <div className="text-sm font-semibold text-sp-text">
                {busyText || "Working…"}
              </div>
            </div>
            <div className="mt-2 text-xs text-sp-muted">
              Don't close the tab 👀
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Inbound</div>
          <h1 className="sp-title">Inbound Import</h1>
          <p className="sp-desc">
            User: <b>{actor}</b>
          </p>
        </div>

        {lastBatchId && (
          <a
            href={`/api/inbound/labels?batch_id=${encodeURIComponent(lastBatchId)}&w_mm=${LABEL_W}&h_mm=${LABEL_H}`}
            className="sp-btn sp-btn-primary"
          >
           QR labels 
          </a>
        )}
      </div>

      {/* SHIPMENT NOTE */}
      <div className="sp-card">
        <label className="sp-label" htmlFor="inbound-shipment-ref">
          Reference / note
        </label>
        <input
          id="inbound-shipment-ref"
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          placeholder="ex: Teltonika delivery 18/03"
          className="sp-input"
        />
      </div>

      {/* MANUAL IMPORT */}
      <div className="sp-card space-y-4">
        <div>
          <div className="font-semibold text-sp-text">Manual Import</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={manualDevice}
            onChange={(e) => setManualDevice(e.target.value)}
            className="sp-select"
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
            className="sp-input"
            value={manualBox}
            onChange={(e) => setManualBox(e.target.value)}
          />

          <select
            value={manualFloor}
            onChange={(e) => setManualFloor(e.target.value)}
            className="sp-select"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>
        </div>

        <textarea
          placeholder="Scan or paste IMEIs (one per line). Only 15-digit kept."
          className="sp-textarea h-40"
          value={manualImeis}
          onChange={(e) => setManualImeis(e.target.value)}
        />

        <div className="flex flex-wrap gap-2">
  <button
    onClick={previewManualImport}
    disabled={busy}
    className="sp-btn sp-btn-primary"
  >
    Preview Manual Import
  </button>

  {manualReadyToImport && (
    <button
      onClick={confirmManualImport}
      disabled={busy}
      className="sp-btn sp-btn-primary"
    >
      Import (Save)
    </button>
  )}
</div>
        {manualMsg && (
          <div
            className={`sp-alert ${
              manualMsg.startsWith("✅")
                ? "sp-alert-ok"
                : manualMsg.startsWith("⚠️")
                  ? "sp-alert-warn"
                  : "sp-alert-err"
            }`}
          >
            {manualMsg}
          </div>
        )}

        {manualPreview?.ok && (
          <div className="sp-card sp-card-tight space-y-2 text-sm">
            <div className="font-semibold">Manual Preview</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="sp-badge sp-badge-neutral">
                Scanned: <b>{manualPreview.total_scanned}</b>
              </span>
              •
              <span className="sp-badge sp-badge-ok">
                New: <b>{manualPreview.valid_new}</b>
              </span>
              •
              <span className="sp-badge sp-badge-err">
                Duplicates: <b>{manualPreview.duplicates}</b>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* EXCEL IMPORT */}
      <div className="sp-card space-y-3">
        <div className="font-semibold text-sp-text">Excel Import</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="sp-select"
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
            className="sp-btn sp-btn-ghost w-full min-w-0"
          />

          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="sp-select"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>

          <button
            onClick={parseExcel}
            disabled={busy}
            className="sp-btn sp-btn-primary"
          >
            {busy ? "Working…" : "Preview import"}
          </button>
        </div>

        {err && (
          <div className="sp-alert sp-alert-err">
            {err}
          </div>
        )}
      </div>

            {result?.ok && (
        <div className="sp-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* LEFT */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="font-semibold">
                  Preview: {excelTotals.boxes} boxes • {excelTotals.imeis} IMEIs
                </div>

                {(result?.unknown_bins_preview?.length ?? 0) > 0 ? (
                  <span className="sp-badge sp-badge-err">
                    ERROR
                  </span>
                ) : (
                  <span className="sp-badge sp-badge-ok">
                    OK
                  </span>
                )}
              </div>

              {result?.devices_found?.length > 0 && (
                <div className="text-xs text-sp-secondary">
                  <b>Devices detected:</b> {result.devices_found.join(", ")}
                </div>
              )}

              {result?.unknown_bins_preview?.length > 0 && (
                <div className="sp-alert sp-alert-err text-xs">
                  <div className="font-semibold">Unknown bins detected</div>
                  <div className="mt-1">{result.unknown_bins_preview.join(", ")}</div>
                </div>
              )}

              {result?.box_breakdown?.length > 0 && (
                <div className="space-y-1 text-xs text-sp-secondary">
                  <b>Boxes detected:</b>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                    {result.box_breakdown.map((b: any) => (
                      <div
                        key={`${b.box_no}-${b.device}`}
                        className="rounded-lg border border-sp-border bg-sp-surface-2 px-2 py-1"
                      >
                        <div className="font-semibold">{b.box_no}</div>
                        <div className="text-[11px] text-sp-secondary">{b.device || "—"}</div>
                        <div className="text-[11px] text-sp-muted">{b.imeis} IMEIs</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT */}
            <button
              onClick={confirmExcelInbound}
              disabled={busy || (result?.unknown_bins_preview?.length ?? 0) > 0}
              className="sp-btn sp-btn-primary"
            >
              Confirm Inbound (Save)
            </button>
          </div>

          {hasUnknownExcelDevices && (
            <div className="sp-alert sp-alert-err">
              <div className="font-semibold">Import blocked</div>
              <div className="mt-1">
                Unknown devices found: <b>{result.unknown_devices.join(", ")}</b>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      <div className="sp-card space-y-3">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <div className="font-semibold">Inbound history</div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">

            <input
  placeholder="Search user / vendor / reference"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  className="sp-input sm:w-56"
/>

            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
              className="sp-select sm:w-auto"
            >
              <option value="all">All</option>
              <option value="excel">Excel only</option>
              <option value="manual">Manual only</option>
            </select>

            <button
              onClick={loadHistory}
              className="sp-btn sp-btn-ghost"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-auto rounded-lg border border-sp-border">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>User</th>
                <th>Vendor</th>
                <th>Reference</th>
                <th className="text-right">Boxes</th>
                <th className="text-right">IMEIs</th>
                <th className="text-right">Excel</th>
                <th className="text-right">Labels</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((h) => (
                <tr key={h.batch_id}>
                  <td>
                    {fmtDateTime(h.created_at)}
                  </td>
                  <td>{h.actor}</td>
                  <td>{h.vendor}</td>
          <td>
  {h.shipment_ref ? (
    <span
      className="sp-badge sp-badge-neutral inline-block max-w-[220px] truncate"
      title={h.shipment_ref}
    >
      {h.shipment_ref}
    </span>
  ) : (
    "-"
  )}
</td>     
                  <td className="text-right font-semibold">
                    {h.qty_boxes}
                  </td>
                  <td className="text-right font-semibold">
                    {h.qty_imeis}
                  </td>
                  <td className="text-right">
                    <a
                      href={`/api/inbound/export?batch_id=${encodeURIComponent(
                        h.batch_id
                      )}`}
                      className="sp-btn sp-btn-ghost"
                    >
                      Excel
                    </a>
                  </td>
                  <td className="text-right">
                    <a
                      href={`/api/inbound/labels?batch_id=${encodeURIComponent(
                        h.batch_id
                      )}&w_mm=105&h_mm=155`}
                      className="sp-btn sp-btn-ghost"
                    >
                      ZD220 PDF
                    </a>
                  </td>
                </tr>
              ))}

              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-3 text-sp-muted">
                    No inbound batches for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
<div className="flex justify-between items-center pt-4">

  <button
    onClick={() => setPage((p) => Math.max(1, p - 1))}
    className="sp-btn sp-btn-ghost"
  >
    Previous
  </button>

  <div className="text-sm text-sp-secondary">
    Page {page}
  </div>

  <button
    onClick={() => setPage((p) => p + 1)}
    className="sp-btn sp-btn-ghost"
  >
    Next
  </button>

</div>

</div>
    </div>
  );
}
