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
    <div className="space-y-8 max-w-5xl relative">

      {/* LOADER */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-5 rounded-2xl flex items-center gap-3">
            <div className="h-5 w-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold text-sm">Processing...</div>
          </div>
        </div>
      )}

      {/* SUCCESS TOAST */}
      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-2xl animate-bounce">
          Stock OUT confirmed successfully ✅
        </div>
      )}

      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Stock Out</h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{actor}</b>
        </p>
      </div>

      {/* Shipment */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold">Shipment reference</div>
        <input
          value={shipmentRef}
          onChange={(e) => setShipmentRef(e.target.value)}
          className="w-full mt-2 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      {/* MANUAL */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold">Manual Scan</div>
        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          className="w-full h-32 mt-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
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
        <div className="font-semibold">Excel Import</div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-3"
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
          <div className="font-semibold text-lg">
            Preview ({previewSource})
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Box</th>
                  <th>Floor</th>
                  <th>Detected</th>
                  <th>Remaining</th>
                  <th>% After</th>
                </tr>
              </thead>
              <tbody>
                {preview.summary.map((row: any, idx: number) => (
                  <tr key={idx}>
                    <td>{row.device}</td>
                    <td>{row.box_no}</td>
                    <td>{row.floor || "-"}</td>
                    <td>{row.detected}</td>
                    <td>{row.remaining}</td>
                    <td>{row.percent_after ?? "-"}%</td>
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

      {errorMsg && (
        <div className="text-rose-400 text-sm">{errorMsg}</div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex justify-between mb-4">
          <div className="font-semibold">Outbound history</div>
          <button
            onClick={loadHistory}
            className="text-sm text-slate-400"
          >
            {loadingHistory ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Source</th>
              <th>Shipment</th>
              <th>Qty</th>
              <th>Excel</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.batch_id}>
                <td>{fmtDateTime(h.created_at)}</td>
                <td>{h.actor}</td>
                <td>{h.source}</td>
                <td>{h.shipment_ref || "-"}</td>
                <td>{h.qty}</td>
                <td>
                  <a
                    href={`/api/outbound/export?batch_id=${h.batch_id}`}
                    className="text-indigo-400"
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