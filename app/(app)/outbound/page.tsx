"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type HistoryRow = {
  batch_id: string;
  created_at: string;
  actor: string;
  shipment_ref: string;
  source: string;
  qty: number;
};

export default function OutboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState<string>("unknown");
  const [shipmentRef, setShipmentRef] = useState("");
  const [imeiInput, setImeiInput] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<any>(null);
  const [previewSource, setPreviewSource] = useState<"manual" | "excel" | null>(null);

  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/outbound/history", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setHistory(json.rows || []);
      else setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // =====================
  // PREVIEW MANUAL
  // =====================
  async function previewManual() {
    setMessage("");
    setPreview(null);

    const imeis = imeiInput
      .split("\n")
      .map((i) => i.replace(/\D/g, ""))
      .filter((i) => i.length === 15);

    if (imeis.length === 0) {
      setMessage("❌ No valid 15-digit IMEIs detected.");
      return;
    }

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeis }),
    });

    const json = await res.json();
    setPreview(json);
    setPreviewSource("manual");
  }

  // =====================
  // PREVIEW EXCEL
  // =====================
  async function previewExcel() {
    setMessage("");
    setPreview(null);

    if (!file) {
      setMessage("❌ Select an Excel file.");
      return;
    }

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    setPreview(json);
    setPreviewSource("excel");
  }

  // =====================
  // CONFIRM (UNIQUE)
  // =====================
  async function confirmOut() {
    setMessage("");

    if (!preview?.ok || !previewSource) return;

    const res = await fetch("/api/outbound/eod-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imeis: preview.imeis,
        shipment_ref: shipmentRef || null,
        actor,
        source: previewSource,
      }),
    });

    const json = await res.json();

    if (json.ok) {
      setMessage(`✅ Stock OUT confirmed (${json.shipped_count} IMEIs)`);
      setPreview(null);
      setPreviewSource(null);
      setImeiInput("");
      setShipmentRef("");
      setFile(null);
      await loadHistory();
    } else {
      setMessage("❌ " + (json.error || "Confirm failed"));
    }
  }

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Stock Out</h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{actor}</b>
        </p>
      </div>

      {/* Shipment reference */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="font-semibold">Shipment reference (optional)</div>
        <input
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          placeholder="Ex: EOD-2026-02-23 / Client / Ticket ..."
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      {/* MANUAL CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="font-semibold">Manual Scan</div>

        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          placeholder="Scan or paste IMEIs (1 per line)"
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />

        <button
          onClick={previewManual}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Manual
        </button>
      </div>

      {/* EXCEL CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="font-semibold">Import End Of Day Report</div>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={previewExcel}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Excel
        </button>
      </div>

      {/* GLOBAL PREVIEW (UNIQUE) */}
      {preview?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div className="font-semibold text-lg">
              Preview ({previewSource})
            </div>
            <div className="text-sm text-slate-400">
              {preview.totalDetected} IMEIs detected
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="p-2 border-b border-slate-800 text-left">Device</th>
                  <th className="p-2 border-b border-slate-800 text-left">Box</th>
                  <th className="p-2 border-b border-slate-800 text-left">Floor</th>
                  <th className="p-2 border-b border-slate-800 text-right">Detected OUT</th>
                  <th className="p-2 border-b border-slate-800 text-right">Remaining</th>
                  <th className="p-2 border-b border-slate-800 text-right">% After</th>
                </tr>
              </thead>
              <tbody>
                {preview.summary.map((row: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800 font-semibold">{row.device}</td>
                    <td className="p-2 border-b border-slate-800">{row.box_no}</td>
                    <td className="p-2 border-b border-slate-800">{row.floor || "—"}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{row.detected}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{row.remaining}</td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {row.percent_after ?? "—"}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={confirmOut}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold"
          >
            Confirm Stock Out
          </button>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
          {message}
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Out of stock history</div>
          <button
            onClick={loadHistory}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            {loadingHistory ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 border-b border-slate-800 text-left">Date/Time</th>
              <th className="p-2 border-b border-slate-800 text-left">User</th>
              <th className="p-2 border-b border-slate-800 text-left">Source</th>
              <th className="p-2 border-b border-slate-800 text-left">Shipment ref</th>
              <th className="p-2 border-b border-slate-800 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.batch_id}>
                <td className="p-2 border-b border-slate-800">{fmtDateTime(h.created_at)}</td>
                <td className="p-2 border-b border-slate-800">{h.actor}</td>
                <td className="p-2 border-b border-slate-800">{h.source}</td>
                <td className="p-2 border-b border-slate-800">{h.shipment_ref || "—"}</td>
                <td className="p-2 border-b border-slate-800 text-right font-semibold">{h.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}