"use client";

import { useState } from "react";

export default function OutboundPage() {
  const [imeiInput, setImeiInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");

  async function previewManual() {
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
  }

  async function previewExcel() {
    if (!file) return;

    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/outbound/eod-preview", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    setPreview(json);
  }

  async function confirmOut() {
    const res = await fetch("/api/outbound/eod-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeis: preview.imeis }),
    });

    const json = await res.json();

    if (json.ok) {
      setMessage("Stock updated successfully ✅");
      setPreview(null);
      setImeiInput("");
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">

      <h2 className="text-xl font-semibold">Outbound</h2>

      {/* MANUAL SCAN */}
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
          className="rounded-xl bg-indigo-600 px-4 py-2"
        >
          Preview Manual
        </button>
      </div>

      {/* EXCEL IMPORT */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="font-semibold">Import End Of Day Report</div>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={previewExcel}
          className="rounded-xl bg-indigo-600 px-4 py-2"
        >
          Preview Excel
        </button>
      </div>

      {/* PREVIEW */}
      {preview?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="font-semibold mb-4">
            {preview.totalDetected} IMEIs detected
          </div>

          {preview.summary.map((s: any, idx: number) => (
            <div key={idx} className="mb-2 text-sm">
              {s.device} — Box {s.box_no} ({s.floor}) →
              {s.detected} out • {s.remaining} remaining
            </div>
          ))}

          <button
            onClick={confirmOut}
            className="mt-4 rounded-xl bg-emerald-600 px-4 py-2"
          >
            Confirm Stock Out
          </button>
        </div>
      )}

      {message && <div>{message}</div>}
    </div>
  );
}