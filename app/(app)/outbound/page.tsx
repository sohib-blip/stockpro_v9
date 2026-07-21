"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";

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
    const res = await apiFetch(
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

    const res = await apiFetch("/api/outbound/eod-preview", {
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
  setErrorMsg("Confirmation blocked. Resolve duplicate, unknown, or previously outbound IMEIs.");
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

    const res = await apiFetch("/api/outbound/eod-preview", {
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
  setErrorMsg("Confirmation blocked. Resolve duplicate, unknown, or previously outbound IMEIs.");
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
  setErrorMsg("Preview the outbound before confirming it.");
  return;
}

if (!actorId) {
  setErrorMsg("Your session could not be verified. Please sign in again.");
  return;
}

    setBusy(true);

    const res = await apiFetch("/api/outbound/eod-confirm", {
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
      return new Date(iso).toLocaleString("en-GB");
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl flex items-center gap-3 shadow-xl">
            <div className="h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold text-sm">Processing…</div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-xl">
          Device outbound completed
        </div>
      )}

      {/* HEADER */}
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Device Outbound</h2>
        <p className="text-sm text-slate-400 mt-1">
          Remove IMEI-tracked devices from stock. Devices become OUT on confirmation.
        </p>
        <p className="mt-1 text-xs text-slate-500">User: <b>{actor}</b></p>
      </div>

      {/* SHIPMENT */}
      <div className="card-glow p-6 relative overflow-hidden">
        <div className="font-semibold mb-2">Shipment reference</div>
        <input
          aria-label="Outbound shipment reference"
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      {/* MANUAL */}
      <div className="card-glow p-6 relative overflow-hidden">
        <div className="font-semibold mb-3">Manual IMEI Entry</div>
        <textarea
          aria-label="Outbound IMEIs"
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />
        <button
          onClick={previewManual}
          className="mt-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Outbound
        </button>
      </div>

      {/* EXCEL */}
      <div className="card-glow p-6 relative overflow-hidden">
        <div className="font-semibold mb-3">End-of-Day Report Import</div>
        <input
          type="file"
          aria-label="Outbound spreadsheet file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={previewExcel}
          className="mt-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Spreadsheet
        </button>
      </div>

{/* ERROR MESSAGE */}
{errorMsg && (
  <div className="bg-red-600/20 border border-red-500 text-red-300 px-4 py-3 rounded-xl text-sm">
    {errorMsg}
  </div>
)}



      {/* PREVIEW */}
{preview && (
  <div className="card-glow p-6 space-y-5 relative overflow-hidden">
    <div className="flex justify-between">
      <div className="font-semibold">
        Preview ({previewSource})
      </div>
      <div className="text-xs text-slate-400">
        {preview.totalDetected ?? 0} IMEIs
      </div>
    </div>

    {preview.duplicates?.length > 0 && (
      <div>
        <div className="font-semibold text-red-300 mb-2">
          Duplicate IMEIs
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 text-left">IMEI</th>
              <th className="p-2 text-right">Occurrences</th>
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
    )}

    {preview.unknown_imeis?.length > 0 && (
      <div>
        <div className="font-semibold text-amber-300 mb-2">
          Unknown IMEIs
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
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
    )}

    {preview.already_out?.length > 0 && (
      <div>
        <div className="font-semibold text-amber-300 mb-2">
          Already Outbound IMEIs
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
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
                <td className="p-2">{row.status || "OUT"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}

    {preview.summary?.length > 0 && (
      <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
        <thead className="bg-slate-950/50">
          <tr>
            <th className="p-2 text-left">Device</th>
            <th className="p-2 text-left">Box</th>
            <th className="p-2 text-left">Floor</th>
            <th className="p-2 text-right">Detected</th>
            <th className="p-2 text-right">Remaining</th>
            <th className="p-2 text-right">Remaining %</th>
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
    )}

    <button
      onClick={confirmOut}
      disabled={!preview?.ok || hasPreviewErrors}
      className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Confirm Outbound
    </button>
  </div>
)}

      {/* HISTORY */}
      <div className="card-glow p-6 space-y-4 relative overflow-hidden">

        <div className="flex items-center justify-between">
          <div className="font-semibold">Outbound History</div>

          <div className="flex gap-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="excel">Spreadsheet</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto border border-slate-800 rounded-xl">
  <table className="w-full text-sm">
    <thead className="bg-slate-950/50">
      <tr>
        <th className="p-2 text-left">Date and Time</th>
        <th className="p-2 text-left">User</th>
        <th className="p-2 text-left">Source</th>
        <th className="p-2 text-left">Shipment Reference</th>
<th className="p-2 text-left">Devices</th>
<th className="p-2 text-right">Quantity</th>
        <th className="p-2 text-right">Export</th>
      </tr>
    </thead>

    <tbody>
      {filteredHistory.map((h) => (
        <tr key={h.history_key || h.operation_id}>
          <td className="p-2">{fmtDateTime(h.created_at)}</td>
          <td className="p-2">{h.actor}</td>
          <td className="p-2 capitalize">{h.source}</td>
          <td className="p-2">{h.shipment_ref || "-"}</td>
<td className="p-2">{h.devices?.join(", ") || "-"}</td>
<td className="p-2 text-right font-semibold">{h.qty}</td>
          <td className="p-2 text-right">
            <button
              onClick={() =>
                downloadApiFile(
                  `/api/outbound/export?operation_id=${encodeURIComponent(h.operation_id)}`,
                  `outbound-${h.operation_id}.xlsx`
                ).catch((error) => setErrorMsg(error.message))
              }
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
            >
              Download
            </button>
          </td>
        </tr>
      ))}
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
