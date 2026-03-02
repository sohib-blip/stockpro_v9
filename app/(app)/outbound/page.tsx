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

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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
      const res = await fetch("/api/outbound/history", {
        cache: "no-store",
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
  }, []);

  // ================= PREVIEW MANUAL =================
  async function previewManual() {
    setErrorMsg("");
    setPreview(null);
    setLoading(true);

    const imeis = imeiInput
      .split("\n")
      .map((i) => i.replace(/\D/g, ""))
      .filter((i) => i.length === 15);

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeis }),
    });

    const json = await res.json();
    setPreview(json);
    setPreviewSource("manual");
    setLoading(false);
  }

  // ================= PREVIEW EXCEL =================
  async function previewExcel() {
    setErrorMsg("");
    setPreview(null);
    if (!file) return;

    setLoading(true);

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    setPreview(json);
    setPreviewSource("excel");
    setLoading(false);
  }

  // ================= CONFIRM =================
  async function confirmOut() {
    if (!preview?.ok || !previewSource || !actorId) return;

    setLoading(true);
    setErrorMsg("");

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
    setLoading(false);

    if (json.ok) {
      setPreview(null);
      setShipmentRef("");
      setImeiInput("");
      setFile(null);
      setSuccess(true);
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

  return (
    <div className="space-y-10 max-w-6xl relative">

      {/* LOADER */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-8 py-6 rounded-2xl flex items-center gap-4 shadow-xl">
            <div className="h-6 w-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold">Processing...</div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="fixed bottom-6 right-6 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="h-6 w-6 bg-white/20 rounded-full flex items-center justify-center">
              ✓
            </div>
            <div className="font-semibold">
              Stock OUT confirmed successfully
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Outbound
          </div>
          <h2 className="text-2xl font-bold text-white">
            Stock Out
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Logged as <span className="font-semibold text-indigo-400">{actor}</span>
          </p>
        </div>
      </div>

      {/* SHIPMENT */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-xl">
        <div className="font-semibold text-white mb-3">
          Shipment Reference
        </div>
        <input
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* MANUAL */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-xl">
        <div className="font-semibold text-white mb-3">
          Manual Scan
        </div>
        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          className="w-full h-36 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={previewManual}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition px-5 py-2.5 font-semibold shadow-lg shadow-indigo-600/20"
        >
          Preview Manual
        </button>
      </div>

      {/* EXCEL */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-xl">
        <div className="font-semibold text-white mb-3">
          Excel Import
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={previewExcel}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition px-5 py-2.5 font-semibold shadow-lg shadow-indigo-600/20"
        >
          Preview Excel
        </button>
      </div>

      {/* PREVIEW */}
      {preview?.ok && (
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-xl space-y-6">
          <div className="flex justify-between items-center">
            <div className="text-lg font-semibold text-white">
              Preview ({previewSource})
            </div>
            <div className="px-3 py-1 rounded-full bg-indigo-600/20 text-indigo-400 text-xs font-semibold">
              {preview.totalDetected} IMEIs
            </div>
          </div>

          <table className="w-full text-sm border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
            <thead className="bg-slate-900">
              <tr>
                <th className="p-3 text-left">Device</th>
                <th className="p-3 text-left">Box</th>
                <th className="p-3 text-left">Floor</th>
                <th className="p-3 text-right">Detected</th>
                <th className="p-3 text-right">Remaining</th>
                <th className="p-3 text-right">% After</th>
              </tr>
            </thead>
            <tbody>
              {preview.summary.map((row: any, idx: number) => (
                <tr key={idx} className="hover:bg-slate-900/60 transition">
                  <td className="p-3">{row.device}</td>
                  <td className="p-3">{row.box_no}</td>
                  <td className="p-3">{row.floor || "-"}</td>
                  <td className="p-3 text-right">{row.detected}</td>
                  <td className="p-3 text-right">{row.remaining}</td>
                  <td className="p-3 text-right">{row.percent_after ?? "-"}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={confirmOut}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition px-6 py-3 font-semibold shadow-lg shadow-emerald-600/20"
          >
            Confirm Stock Out
          </button>
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-xl">
        <div className="flex justify-between mb-5">
          <div className="font-semibold text-white">
            Outbound History
          </div>
          <button
            onClick={loadHistory}
            className="text-sm text-slate-400 hover:text-white"
          >
            {loadingHistory ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">User</th>
              <th className="text-left p-2">Source</th>
              <th className="text-left p-2">Shipment</th>
              <th className="text-right p-2">Qty</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.batch_id} className="hover:bg-slate-900/50">
                <td className="p-2">{fmtDateTime(h.created_at)}</td>
                <td className="p-2">{h.actor}</td>
                <td className="p-2">{h.source}</td>
                <td className="p-2">{h.shipment_ref || "-"}</td>
                <td className="p-2 text-right">{h.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}