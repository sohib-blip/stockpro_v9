"use client";

import { useState } from "react";

export default function OutboundPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");

  async function handlePreview() {
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

  async function handleConfirm() {
    const res = await fetch("/api/outbound/eod-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeis: preview.imeis }),
    });

    const json = await res.json();
    if (json.ok) {
      setMessage("Stock updated successfully ✅");
      setPreview(null);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold">End Of Day Import</h2>

      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
      />

      <button
        onClick={handlePreview}
        className="rounded-xl bg-indigo-600 px-4 py-2"
      >
        Preview
      </button>

      {preview?.ok && (
        <div className="rounded-xl border border-slate-800 p-4 bg-slate-900">
          <div className="mb-3 font-semibold">
            {preview.totalDetected} IMEIs detected
          </div>

          {preview.summary.map((s: any, idx: number) => (
            <div key={idx} className="text-sm mb-2">
              {s.device} — Box {s.box_no} → 
              {s.detected} out • {s.remaining} remaining
            </div>
          ))}

          <button
            onClick={handleConfirm}
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