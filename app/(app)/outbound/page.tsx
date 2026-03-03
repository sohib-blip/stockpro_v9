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
      `/api/outbound/history?t=${Date.now()}`, // 🔥 cache buster
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
  }, []);

  // ================= PREVIEW MANUAL =================
  async function previewManual() {
    setBusy(true);
    setErrorMsg("");
    setPreview(null);

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
    setPreview(json);
    setPreviewSource("excel");
    setBusy(false);
  }

  // ================= CONFIRM =================
  async function confirmOut() {
    if (!preview?.ok || !previewSource || !actorId) return;

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

  return (
    <div className="space-y-10 max-w-6xl">

      {/* LOADER */}
      {busy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl flex items-center gap-3 shadow-xl">
            <div className="h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold text-sm">Processing...</div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-xl">
          ✅ Stock OUT confirmed
        </div>
      )}

      {/* HEADER */}
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Stock Out</h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{actor}</b>
        </p>
      </div>

      {/* SHIPMENT */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold mb-2">Shipment reference</div>
        <input
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      {/* MANUAL */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold mb-3">Manual Scan</div>
        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />
        <button
          onClick={previewManual}
          className="mt-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Manual
        </button>
      </div>

      {/* EXCEL */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold mb-3">Import End Of Day Report</div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          onClick={previewExcel}
          className="mt-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Excel
        </button>
      </div>

      {/* PREVIEW */}
      {preview?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex justify-between">
            <div className="font-semibold">
              Preview ({previewSource})
            </div>
            <div className="text-xs text-slate-400">
              {preview.totalDetected} IMEIs
            </div>
          </div>

          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
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
                  <td className="p-2 text-right">
                    {row.percent_after ?? "-"}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={confirmOut}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold"
          >
            Confirm Stock Out
          </button>
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">

        <div className="flex items-center justify-between">
          <div className="font-semibold">Outbound history</div>

          <div className="flex gap-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="manual">Manual</option>
              <option value="excel">Excel</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 text-left">Date/Time</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Source</th>
              <th className="p-2 text-left">Shipment ref</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Excel</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((h) => (
              <tr key={h.batch_id}>
                <td className="p-2">{fmtDateTime(h.created_at)}</td>
                <td className="p-2">{h.actor}</td>
                <td className="p-2 capitalize">{h.source}</td>
                <td className="p-2">{h.shipment_ref || "-"}</td>
                <td className="p-2 text-right font-semibold">{h.qty}</td>
                <td className="p-2 text-right">
                  <a
                    href={`/api/outbound/export?batch_id=${encodeURIComponent(h.batch_id)}`}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                  >
                    Excel
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