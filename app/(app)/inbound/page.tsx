"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";
type HistoryFilter = "all" | "excel" | "manual";

type HistoryRow = {
  batch_id: string;
  created_at: string;
  actor: string;
  vendor: string;
  source: string;
  shipment_ref?: string;
  qty_imeis: number;
  qty_boxes: number;
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

  // Excel import
  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string>("");
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
  const [inputMode, setInputMode] = useState<"manual" | "spreadsheet">("manual");

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
    const res = await apiFetch(`/api/inbound/history?page=${page}`, {
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
      return new Date(iso).toLocaleString("en-GB");
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

    startBusy("Preparing spreadsheet preview…");
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

        // Build preview details.
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

            // Flag boxes that contain more than one device type.
            if (deviceName && boxAgg[boxNo].device && boxAgg[boxNo].device !== deviceName) {
              boxAgg[boxNo].device = "MULTI";
            } else if (deviceName && !boxAgg[boxNo].device) {
              boxAgg[boxNo].device = deviceName;
            }
          }
        }

        // Detect unknown bins directly in the preview.
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

        const spreadsheetImeis = Array.from(
          new Set(
            (parsed.labels || []).flatMap((label: any) =>
              (label.imeis || [])
                .map((imei: unknown) => String(imei).replace(/\D/g, ""))
                .filter((imei: string) => imei.length === 15)
            )
          )
        ) as string[];
        const existingImeis = new Set<string>();

        for (let index = 0; index < spreadsheetImeis.length; index += 200) {
          const chunk = spreadsheetImeis.slice(index, index + 200);
          const { data: existingRows, error: existingError } = await supabase
            .from("items")
            .select("imei")
            .in("imei", chunk);

          if (existingError) throw existingError;
          for (const row of existingRows || []) {
            existingImeis.add(String(row.imei));
          }
        }

        (parsed as any).stock_check = {
          total: spreadsheetImeis.length,
          existing: existingImeis.size,
          new: spreadsheetImeis.length - existingImeis.size,
        };
      }

      if (!parsed?.ok) {
        setErr(parsed?.error || "Parse failed");
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

    if (result.stock_check?.total > 0 && result.stock_check?.new === 0) {
      const total = Number(result.stock_check.total);
      setErr(
        `Import blocked: all ${total} ${total === 1 ? "IMEI" : "IMEIs"} from this spreadsheet ${total === 1 ? "is" : "are"} already in stock. Nothing was imported and no history was created.`
      );
      return;
    }

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

      const res = await apiFetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!json.ok) {
        if (json.code === "ALL_IMEIS_ALREADY_IN_STOCK") {
          setResult((current: any) => ({
            ...current,
            stock_check: {
              total: json.totals?.skipped_existing_imeis || 0,
              existing: json.totals?.skipped_existing_imeis || 0,
              new: 0,
            },
          }));
          setErr(json.error);
          return;
        }
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
        `Inbound completed\nImported: ${json.totals.inserted_imeis}\nSkipped (already in stock): ${json.totals.skipped_existing_imeis}\nBoxes created: ${json.totals.created_boxes}\nBoxes reused: ${json.totals.reused_boxes}`
      );

      // Refresh history without reloading the page.
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
  const allExcelImeisAlreadyInStock =
    result?.ok && result.stock_check?.total > 0 && result.stock_check?.new === 0;

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

    if (!manualDevice) return setManualMsg("Select a device.");
    if (!manualBox.trim()) return setManualMsg("Enter a box number.");
    if (imeis.length === 0) return setManualMsg("No valid 15-digit IMEIs found.");

    startBusy("Preparing manual inbound preview…");
    try {
      const res = await apiFetch("/api/inbound/manual-preview", {
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
  setManualMsg(json.error || "Manual preview failed");
  return;
}

setManualPreview(json);
setManualReadyToImport(true);
setManualMsg("");
    } catch (e: any) {
      setManualMsg(e?.message || "Manual preview failed");
    } finally {
      stopBusy();
    }
  }

  async function confirmManualImport() {
    setManualMsg("");

    if (!manualReadyToImport) {
    return setManualMsg("Preview the inbound before confirming it.");
  }

    if (!manualPreview?.ok) return setManualMsg("No preview is available.");

    const imeisToInsert: string[] = manualPreview.preview_imeis || [];
    if (imeisToInsert.length === 0) return setManualMsg("Nothing to import. All IMEIs may already be in stock.");

    startBusy("Importing manual inbound…");
    try {
      const res = await apiFetch("/api/inbound/manual-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device: manualDevice,
          box_no: manualBox.trim(),
          floor: manualFloor,
          imeis: imeisToInsert,
          shipment_ref: shipmentRef.trim() || null,
          actor,
          actor_id: actorId,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setManualMsg(json.error || "Manual confirmation failed");
        return;
      }

      if (json.inserted === 0) {
        setManualMsg(`Nothing was imported. Existing IMEIs skipped: ${json.skipped_existing || 0}.`);
        setManualPreview(null);
        return;
      }

      setLastBatchId(json.batch_id);

      setManualPreview(null);
      setManualImeis("");
      setManualBox("");

      const skipped = json.skipped_existing || 0;
      setManualMsg(`Manual inbound completed: ${json.inserted} IMEIs imported, ${skipped} existing IMEIs skipped.`);

      // Refresh history without reloading the page.
      await loadHistory();
    } catch (e: any) {
      setManualMsg(e?.message || "Manual confirmation failed");
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
  <div className="prototype-page prototype-module-page inbound-prototype-page">
      {/* Global processing overlay */}
      {busy && (
        <div className="fixed inset-0 z-[999] bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 px-6 py-5 w-full max-w-sm">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
              <div className="font-semibold text-sm text-slate-200">
                {busyText || "Working…"}
              </div>
            </div>
            <div className="text-xs text-slate-400 mt-2">
              Keep this tab open while processing.
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="prototype-page-header">
        <div>
          <h1>Inbound Processing</h1>
          <p>
            Register received IMEIs, boxes and floors. Nothing changes until you confirm.
          </p>
        </div>
        <button
          type="button"
          className="prototype-button secondary"
          onClick={() => document.getElementById("inbound-history")?.scrollIntoView({ behavior: "smooth" })}
        >
          History &amp; exports
        </button>
      </div>

      <div className="prototype-stepper" aria-label="Inbound progress">
        <div className={`prototype-step ${!manualPreview && !result && !lastBatchId ? "is-active" : "is-complete"}`}><span>{manualPreview || result || lastBatchId ? "✓" : "1"}</span><strong>Input</strong></div>
        <i />
        <div className={`prototype-step ${manualPreview || result ? "is-active" : lastBatchId ? "is-complete" : ""}`}><span>{lastBatchId ? "✓" : "2"}</span><strong>Preview</strong></div>
        <i />
        <div className={`prototype-step ${lastBatchId ? "is-active" : ""}`}><span>3</span><strong>Confirm</strong></div>
      </div>

      {/* Manual inbound */}
      <div className="prototype-process-grid">
      <div className="prototype-process-input-column">
        <div className="prototype-segmented-control">
          <button type="button" className={inputMode === "manual" ? "is-active" : ""} onClick={() => setInputMode("manual")}>Manual Inbound</button>
          <button type="button" className={inputMode === "spreadsheet" ? "is-active" : ""} onClick={() => setInputMode("spreadsheet")}>Spreadsheet Import</button>
        </div>

        <div className="prototype-shared-reference">
          <label htmlFor="inbound-reference">Reference or note <span>(optional)</span></label>
          <input
            id="inbound-reference"
            aria-label="Inbound reference"
            value={shipmentRef}
            onChange={(e) => setShipmentRef(e.target.value)}
            placeholder="e.g. Teltonika delivery 21/07"
          />
        </div>

      {inputMode === "manual" && (
      <div className="prototype-input-card">
        <div>
          <div className="prototype-input-section-title">Manual Inbound</div>
        </div>

        <div className="inbound-manual-fields">
          <select
            aria-label="Manual inbound device"
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
            aria-label="Manual inbound box"
            placeholder="Box number"
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            value={manualBox}
            onChange={(e) => setManualBox(e.target.value)}
          />

          <select
            aria-label="Manual inbound floor"
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

        <div className="prototype-field-heading"><label htmlFor="manual-imeis">IMEIs — scan or paste, one per line</label><span>{extractManualImeis(manualImeis).length} detected</span></div>
        <textarea
          id="manual-imeis"
          aria-label="Manual inbound IMEIs"
          placeholder="Scan or paste IMEIs (one per line). Only 15-digit kept."
          className="prototype-imei-textarea"
          value={manualImeis}
          onChange={(e) => setManualImeis(e.target.value)}
        />

        <div className="flex flex-wrap gap-2">
  <button
    onClick={previewManualImport}
    disabled={busy}
    className="prototype-button primary grow"
  >
    Preview Inbound
  </button>

</div>
        {manualMsg && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
            {manualMsg}
          </div>
        )}

        {manualPreview?.ok && (
          <div className="hidden">
            <div className="font-semibold">Manual Preview</div>
            <div>
              Scanned: <b>{manualPreview.total_scanned}</b> • New:{" "}
              <b>{manualPreview.valid_new}</b> • Duplicates:{" "}
              <b>{manualPreview.duplicates}</b>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Spreadsheet import */}
      {inputMode === "spreadsheet" && (
      <div className="prototype-input-card">
        <div className="prototype-input-section-title">Spreadsheet Import</div>

        <div className="spreadsheet-import-grid">
          <select
            aria-label="Inbound spreadsheet vendor"
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="teltonika">Teltonika</option>
            <option value="quicklink">Quicklink</option>
            <option value="digitalmatter">Digital Matter</option>
            <option value="truster">Truster</option>
          </select>

          <select
            aria-label="Inbound spreadsheet floor"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>

          <input
            type="file"
            aria-label="Inbound spreadsheet file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="spreadsheet-file-input"
          />

          <button
            onClick={parseExcel}
            disabled={busy}
            className="prototype-button primary"
          >
            {busy ? "Working…" : "Preview Import"}
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}
      </div>
      )}
      </div>

      {result?.ok && (
        <div className="prototype-preview-card">
          <div className="prototype-preview-content">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="font-semibold">
                  Preview: {excelTotals.boxes} boxes • {excelTotals.imeis} IMEIs
                </div>

                {(result?.unknown_bins_preview?.length ?? 0) > 0 || allExcelImeisAlreadyInStock ? (
                  <span className="px-2 py-1 text-xs rounded-lg bg-rose-900/60 text-rose-200 border border-rose-800">
                    ERROR
                  </span>
                ) : (
                  <span className="px-2 py-1 text-xs rounded-lg bg-emerald-900/60 text-emerald-200 border border-emerald-800">
                    OK
                  </span>
                )}
              </div>

              {result?.devices_found?.length > 0 && (
                <div className="text-xs text-slate-400">
                  <b>Devices detected:</b> {result.devices_found.join(", ")}
                </div>
              )}

              {result?.unknown_bins_preview?.length > 0 && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">
                  <div className="font-semibold">Unknown bins detected</div>
                  <div className="mt-1">{result.unknown_bins_preview.join(", ")}</div>
                </div>
              )}

              {allExcelImeisAlreadyInStock && (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
                  <div className="font-semibold">Import blocked — already in stock</div>
                  <div className="mt-1">
                    {`All ${result.stock_check.total} ${result.stock_check.total === 1 ? "IMEI" : "IMEIs"} from this spreadsheet already ${result.stock_check.total === 1 ? "exists" : "exist"} in stock. Nothing will be imported and no history entry will be created.`}
                  </div>
                </div>
              )}

              {!allExcelImeisAlreadyInStock && result?.stock_check?.existing > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200">
                  <div className="font-semibold">Existing stock detected</div>
                  <div className="mt-1">
                    {`${result.stock_check.existing} existing IMEIs will be skipped and ${result.stock_check.new} new IMEIs will be imported.`}
                  </div>
                </div>
              )}

              {result?.box_breakdown?.length > 0 && (
                <div className="text-xs text-slate-400 space-y-1">
                  <b>Boxes detected:</b>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                    {result.box_breakdown.map((b: any) => (
                      <div
                        key={`${b.box_no}-${b.device}`}
                        className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1"
                      >
                        <div className="font-semibold">{b.box_no}</div>
                        <div className="text-[11px] text-slate-400">{b.device || "—"}</div>
                        <div className="text-[11px] text-slate-500">{b.imeis} IMEIs</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
          <div className="prototype-preview-actions">
            <button
              type="button"
              onClick={confirmExcelInbound}
              disabled={
                busy ||
                (result?.unknown_bins_preview?.length ?? 0) > 0 ||
                allExcelImeisAlreadyInStock
              }
              className="prototype-button confirm"
            >
              {allExcelImeisAlreadyInStock ? "Already in stock" : "Confirm Inbound"}
            </button>
          </div>
        </div>
      )}

      {manualPreview?.ok && !result?.ok && (
        <div className="prototype-preview-card">
          <div className="prototype-success-banner">
            <span>✓</span>
            <div><strong>Preview ready — no blocking problems</strong><p>{manualPreview.valid_new} devices will be added to stock.</p></div>
          </div>
          <div className="prototype-preview-chips">
            <span className="success">{manualPreview.valid_new} valid</span>
            <span>{manualPreview.duplicates} duplicates</span>
            <span>1 box</span>
          </div>
          <div className="prototype-preview-summary">
            <div><span>Device bin</span><strong>{devices.find((device) => device.device_id === manualDevice)?.device || "—"}</strong></div>
            <div><span>Box</span><strong>{manualBox || "—"}</strong></div>
            <div><span>Floor</span><strong>Floor {manualFloor}</strong></div>
            <div><span>New IMEIs</span><strong>{manualPreview.valid_new}</strong></div>
          </div>
          <div className="prototype-preview-footer">
            <span>No blocking errors. Review the summary before confirmation.</span>
            <button type="button" onClick={confirmManualImport} disabled={busy || !manualReadyToImport} className="prototype-button confirm">Confirm Inbound</button>
          </div>
        </div>
      )}

      {!manualPreview?.ok && !result?.ok && (
        <div className="prototype-empty-preview">
          <div className="prototype-empty-icon"><span /></div>
          <strong>No preview yet</strong>
          <p>Fill in the box, scan or paste IMEIs, then run <b>Preview Inbound</b>. You will see every device and problem before anything is committed.</p>
        </div>
      )}
      </div>

      {lastBatchId && (
        <div className="prototype-completion-card">
          <div className="prototype-success-banner">
            <span>✓</span>
            <div><strong>Inbound completed</strong><p>{shipmentRef || "Manual inbound"} · {actor}</p></div>
            <div className="prototype-page-actions">
              <button type="button" className="prototype-button secondary" onClick={() => downloadApiFile(`/api/inbound/export?batch_id=${encodeURIComponent(lastBatchId)}`, `inbound-${lastBatchId}.xlsx`).catch((error) => setErr(error.message))}>Download batch Excel</button>
              <button type="button" className="prototype-button confirm" onClick={() => downloadApiFile(`/api/inbound/labels?batch_id=${encodeURIComponent(lastBatchId)}&w_mm=${LABEL_W}&h_mm=${LABEL_H}`, `labels-${lastBatchId}.pdf`).catch((error) => setErr(error.message))}>Download ZD220 label PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY */}
      <div id="inbound-history" className="prototype-card prototype-history-card">
        <div className="inbound-history-toolbar">
          <div>
            <div className="font-semibold">Inbound History</div>
            <div className="text-xs text-slate-500">
            </div>
          </div>

          <div className="inbound-history-filters">

            <input
  placeholder="Search user / vendor / reference"
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm w-56"
/>

            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="excel">Spreadsheet</option>
              <option value="manual">Manual</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="inbound-history-table border border-slate-800 rounded-xl">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 border-b border-slate-800 text-left">Date and Time</th>
                <th className="p-2 border-b border-slate-800 text-left">User</th>
                <th className="p-2 border-b border-slate-800 text-left">Vendor</th>
                <th className="p-2 border-b border-slate-800 text-left">Reference</th>
                <th className="p-2 border-b border-slate-800 text-right">Boxes</th>
                <th className="p-2 border-b border-slate-800 text-right">IMEIs</th>
                <th className="p-2 border-b border-slate-800 text-right">Export</th>
                <th className="p-2 border-b border-slate-800 text-right">Labels</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory.map((h) => (
                <tr key={h.batch_id} className="hover:bg-slate-950/40">
                  <td className="p-2 border-b border-slate-800">
                    {fmtDateTime(h.created_at)}
                  </td>
                  <td className="p-2 border-b border-slate-800">{h.actor}</td>
                  <td className="p-2 border-b border-slate-800">{h.vendor}</td>
          <td className="p-2 border-b border-slate-800">
  {h.shipment_ref ? (
    <span
      className="px-2 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 max-w-[220px] truncate inline-block"
      title={h.shipment_ref}
    >
      {h.shipment_ref}
    </span>
  ) : (
    "-"
  )}
</td>     
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">
                    {h.qty_boxes}
                  </td>
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">
                    {h.qty_imeis}
                  </td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <button
                      onClick={() =>
                        downloadApiFile(
                          `/api/inbound/export?batch_id=${encodeURIComponent(h.batch_id)}`,
                          `inbound-${h.batch_id}.xlsx`
                        ).catch((error) => setErr(error.message))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                    >
                      Download
                    </button>
                  </td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <button
                      onClick={() =>
                        downloadApiFile(
                          `/api/inbound/labels?batch_id=${encodeURIComponent(h.batch_id)}&w_mm=105&h_mm=155`,
                          `labels-${h.batch_id}.pdf`
                        ).catch((error) => setErr(error.message))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                    >
                      ZD220 PDF
                    </button>
                  </td>
                </tr>
              ))}

              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-3 text-slate-400">
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
    className="rounded-xl border border-slate-800 px-4 py-2 text-sm hover:bg-slate-800"
  >
    Previous
  </button>

  <div className="text-sm text-slate-400">
    Page {page}
  </div>

  <button
    onClick={() => setPage((p) => p + 1)}
    className="rounded-xl border border-slate-800 px-4 py-2 text-sm hover:bg-slate-800"
  >
    Next
  </button>

</div>

</div>
    </div>
  );
}
