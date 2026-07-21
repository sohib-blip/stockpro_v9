"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type HistoryRow = {
  operation_id: string;
  created_at: string;
  actor: string;
  shipment_ref: string;
  source: string;
  qty: number;
  devices?: string[];
  imeis_count?: number;
  history_key?: string;
};

export default function OutboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState<string | null>(null);

  const [shipmentRef, setShipmentRef] = useState("");
  const [imeiInput, setImeiInput] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<any>(null);
  const [previewSource, setPreviewSource] =
    useState<"manual" | "excel" | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
const [page, setPage] = useState(1);

  const [filter, setFilter] = useState("all");

  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const filteredHistory =
    filter === "all"
      ? history
      : history.filter((h) => h.source === filter);

  // ================= USER =================
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (user?.email) setActor(user.email);
      if (user?.id) setActorId(user.id);
    })();
  }, [supabase]);

  // ================= HISTORY =================
  async function loadHistory() {
  setLoadingHistory(true);
  try {
    const res = await fetch(
      `/api/outbound/history?page=${page}&t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      }
    );

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

  // ================= PREVIEW MANUAL =================
  async function previewManual() {
    setBusy(true);
setErrorMsg("");
setPreview(null);

    const imeis = imeiInput.match(/\d{15}/g) || [];

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeisText: imeiInput, imeis }),
    });

    const json = await res.json();
    if (!json.unknown_imeis) json.unknown_imeis = [];
if (!json.already_out) json.already_out = [];
if (!json.duplicates) json.duplicates = [];
if (!json.summary) json.summary = [];

if (!json.ok) {
  setPreview(json);
  setPreviewSource("manual");
  setErrorMsg("⚠ Confirm blocked. Please correct duplicate, unknown or already outbound IMEIs.");
  setBusy(false);
  return;
}

setPreview(json);
setPreviewSource("manual");
setBusy(false);
  }

  // ================= PREVIEW EXCEL =================
  async function previewExcel() {
    if (!file) return;

    setBusy(true);
    setErrorMsg("");
    setPreview(null);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    if (!json.unknown_imeis) json.unknown_imeis = [];
if (!json.already_out) json.already_out = [];
if (!json.duplicates) json.duplicates = [];
if (!json.summary) json.summary = [];

if (!json.ok) {
  setPreview(json);
  setPreviewSource("excel");
  setErrorMsg("⚠ Confirm blocked. Please correct duplicate, unknown or already outbound IMEIs.");
  setBusy(false);
  return;
}

setPreview(json);
setPreviewSource("excel");
setBusy(false);
  }

  // ================= CONFIRM =================
  async function confirmOut() {
    if (!preview?.ok || !previewSource) {
  setErrorMsg("Preview missing");
  return;
}

if (!actorId) {
  setErrorMsg("User not authenticated");
  return;
}

    setBusy(true);

    const res = await fetch("/api/outbound/eod-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imeis: preview.imeis,
        shipment_ref: shipmentRef || null,
        actor,
        actor_id: actorId,
        source: previewSource,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (json.ok) {
      setSuccess(true);
      setPreview(null);
      setShipmentRef("");
      setImeiInput("");
      setFile(null);
      await loadHistory();
      setTimeout(() => setSuccess(false), 2500);
    } else {
      setErrorMsg(json.error || "Confirm failed");
    }
  }

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  const hasPreviewErrors =
  preview?.duplicates?.length > 0 ||
  preview?.already_out?.length > 0 ||
  preview?.unknown_imeis?.length > 0;

  return (
    <div className="space-y-10 w-full">

      {/* LOADER */}
      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="sp-card flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-sp-primary border-t-transparent" />
            <div className="text-sm font-semibold text-sp-text">Processing...</div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="sp-alert sp-alert-ok fixed bottom-6 right-6 z-40">
          ✅ Stock OUT confirmed
        </div>
      )}

      {/* HEADER */}
      <div className="sp-page-header">
        <div>
        <div className="sp-eyebrow">Outbound</div>
        <h1 className="sp-title">Stock Out</h1>
        <p className="sp-desc">
          User: <b>{actor}</b>
        </p>
        </div>
      </div>

      {/* SHIPMENT */}
      <div className="sp-card">
        <label className="sp-label" htmlFor="outbound-shipment-ref">
          Shipment reference
        </label>
        <input
          id="outbound-shipment-ref"
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          className="sp-input"
        />
      </div>

      {/* MANUAL */}
      <div className="sp-card">
        <label className="sp-label" htmlFor="outbound-manual-scan">
          Manual Scan
        </label>
        <textarea
          id="outbound-manual-scan"
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          className="sp-textarea h-40"
        />
        <button
          onClick={previewManual}
          className="sp-btn sp-btn-primary mt-4"
        >
          Preview Manual
        </button>
      </div>

      {/* EXCEL */}
      <div className="sp-card">
        <div className="mb-3 font-semibold text-sp-text">Import End Of Day Report</div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="sp-btn sp-btn-ghost"
        />
        <button
          onClick={previewExcel}
          className="sp-btn sp-btn-primary mt-4"
        >
          Preview Excel
        </button>
      </div>

{/* ERROR MESSAGE */}
{errorMsg && (
  <div className="sp-alert sp-alert-err">
    {errorMsg}
  </div>
)}



      {/* PREVIEW */}
{preview && (
  <div className="sp-card space-y-5">
    <div className="flex justify-between">
      <div className="font-semibold">
        Preview ({previewSource})
      </div>
      <div className={`sp-badge ${hasPreviewErrors ? "sp-badge-err" : "sp-badge-ok"}`}>
        {preview.totalDetected ?? 0} IMEIs
      </div>
    </div>

    {preview.duplicates?.length > 0 && (
      <div>
        <div className="sp-badge sp-badge-err mb-2">
          Duplicate IMEIs
        </div>

        <div className="overflow-x-auto rounded-lg border border-sp-border">
        <table className="sp-table">
          <thead>
            <tr>
              <th className="p-2 text-left">IMEI</th>
              <th className="p-2 text-right">Times found</th>
            </tr>
          </thead>
          <tbody>
            {preview.duplicates.map((d: any) => (
              <tr key={d.imei}>
                <td className="p-2">{d.imei}</td>
                <td className="p-2 text-right font-semibold">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    )}

    {preview.unknown_imeis?.length > 0 && (
      <div>
        <div className="sp-badge sp-badge-err mb-2">
          Unknown IMEIs
        </div>

        <div className="overflow-x-auto rounded-lg border border-sp-border">
        <table className="sp-table">
          <thead>
            <tr>
              <th className="p-2 text-left">IMEI</th>
            </tr>
          </thead>
          <tbody>
            {preview.unknown_imeis.map((imei: string) => (
              <tr key={imei}>
                <td className="p-2">{imei}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    )}

    {preview.already_out?.length > 0 && (
      <div>
        <div className="sp-badge sp-badge-err mb-2">
          Already OUT IMEIs
        </div>

        <div className="overflow-x-auto rounded-lg border border-sp-border">
        <table className="sp-table">
          <thead>
            <tr>
              <th className="p-2 text-left">IMEI</th>
              <th className="p-2 text-left">Device</th>
              <th className="p-2 text-left">Box</th>
              <th className="p-2 text-left">Floor</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.already_out.map((row: any) => (
              <tr key={row.imei}>
                <td className="p-2">{row.imei}</td>
                <td className="p-2">{row.device || "-"}</td>
                <td className="p-2">{row.box || "-"}</td>
                <td className="p-2">{row.floor || "-"}</td>
                <td className="p-2">
                  <span className="sp-badge sp-badge-err">
                    {row.status || "OUT"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    )}

    {preview.summary?.length > 0 && (
      <div className="overflow-x-auto rounded-lg border border-sp-border">
      <table className="sp-table">
        <thead>
          <tr>
            <th className="p-2 text-left">Device</th>
            <th className="p-2 text-left">Box</th>
            <th className="p-2 text-left">Floor</th>
            <th className="p-2 text-right">Detected</th>
            <th className="p-2 text-right">Remaining</th>
            <th className="p-2 text-right">% After</th>
          </tr>
        </thead>
        <tbody>
          {preview.summary.map((row: any, idx: number) => (
            <tr key={idx}>
              <td className="p-2">{row.device}</td>
              <td className="p-2">{row.box_no}</td>
              <td className="p-2">{row.floor || "-"}</td>
              <td className="p-2 text-right">{row.detected}</td>
              <td className="p-2 text-right">{row.remaining}</td>
              <td className="p-2 text-right">{row.percent_after ?? "-"}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    )}

    <button
      onClick={confirmOut}
      disabled={!preview?.ok || hasPreviewErrors}
      className="sp-btn sp-btn-primary"
    >
      Confirm Stock Out
    </button>
  </div>
)}

      {/* HISTORY */}
      <div className="sp-card space-y-4">

        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="font-semibold">Outbound history</div>

          <div className="flex gap-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="sp-select sm:w-auto"
            >
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="excel">Excel</option>
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
        <th className="p-2 text-left">Date/Time</th>
        <th className="p-2 text-left">User</th>
        <th className="p-2 text-left">Source</th>
        <th className="p-2 text-left">Shipment ref</th>
<th className="p-2 text-left">Devices</th>
<th className="p-2 text-right">Qty</th>
        <th className="p-2 text-right">Excel</th>
      </tr>
    </thead>

    <tbody>
      {filteredHistory.map((h) => (
        <tr key={h.history_key || h.operation_id}>
          <td className="p-2">{fmtDateTime(h.created_at)}</td>
          <td className="p-2">{h.actor}</td>
          <td className="p-2 capitalize">
            <span className={`sp-badge ${h.source === "excel" ? "sp-badge-info" : "sp-badge-neutral"}`}>
              {h.source}
            </span>
          </td>
          <td className="p-2">{h.shipment_ref || "-"}</td>
<td className="p-2">{h.devices?.join(", ") || "-"}</td>
<td className="p-2 text-right font-semibold">{h.qty}</td>
          <td className="p-2 text-right">
            <a
              href={`/api/outbound/export?operation_id=${encodeURIComponent(h.operation_id)}`}
              className="sp-btn sp-btn-ghost"
            >
              Excel
            </a>
          </td>
        </tr>
      ))}
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
