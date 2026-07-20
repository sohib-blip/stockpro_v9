"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiFetch";

type Accessory = {
  id: string;
  name: string;
  current_stock?: number;
};

type ManualLine = {
  accessory_id: string;
  qty: number;
};

type PreviewRow = {
  accessory_bin_id: string;
  accessory: string;
  qty: number;
  current_stock: number;
  after_stock: number;
};

export default function AccessoriesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState<string | null>(null);

  const [shipmentRef, setShipmentRef] = useState("");
  const [comment, setComment] = useState("");

  const [accessories, setAccessories] = useState<Accessory[]>([]);
  const [lines, setLines] = useState<ManualLine[]>([
    { accessory_id: "", qty: 1 },
  ]);

  const [file, setFile] = useState<File | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewType, setPreviewType] = useState<"manual" | "excel" | null>(
    null
  );
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);

  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (user?.email) setActor(user.email);
    if (user?.id) setActorId(user.id);
  }

  async function loadAccessories() {
    const res = await apiFetch(`/api/accessory-bins/list?t=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) setAccessories(json.rows || []);
  }

  async function loadHistory() {
    try {
      const res = await apiFetch(
        `/api/accessories/outbound/history?t=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json();

      if (!res.ok || !json.ok) {
        setHistory([]);
        setErrorMsg(json.error || "Unable to load accessory outbound history");
        return;
      }

      setHistory(json.rows || []);
    } catch (error) {
      setHistory([]);
      setErrorMsg(
        error instanceof Error ? error.message : "Unable to load accessory outbound history"
      );
    }
  }

  useEffect(() => {
    loadUser();
    loadAccessories();
    loadHistory();
  }, []);

  function updateLine(index: number, patch: Partial<ManualLine>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, { accessory_id: "", qty: 1 }]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewType(null);
    setPreviewRows([]);
  }

  async function previewManualOutbound() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");

    const cleanLines = lines.filter(
      (l) => l.accessory_id && Number(l.qty) > 0
    );

    if (cleanLines.length === 0) {
      setBusy(false);
      setErrorMsg("Add at least one accessory line.");
      return;
    }

    const res = await apiFetch("/api/accessories/outbound/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipment_ref: shipmentRef || null,
        comment: comment || null,
        actor,
        actor_id: actorId,
        lines: cleanLines,
        preview: "1",
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Manual preview failed");
      return;
    }

    setPreviewRows(json.rows || []);
    setPreviewType("manual");
    setPreviewOpen(true);
  }

  async function confirmManualOutbound() {
    setErrorMsg("");
    setSuccessMsg("");

    const cleanLines = lines.filter(
      (l) => l.accessory_id && Number(l.qty) > 0
    );

    const res = await apiFetch("/api/accessories/outbound/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipment_ref: shipmentRef || null,
        comment: comment || null,
        actor,
        actor_id: actorId,
        lines: cleanLines,
        preview: "0",
      }),
    });

    const json = await res.json();

    if (!json.ok) {
      setErrorMsg(json.error || "Manual outbound failed");
      return;
    }

    closePreview();
    setSuccessMsg("Accessory outbound completed");
    setLines([{ accessory_id: "", qty: 1 }]);
    setShipmentRef("");
    setComment("");

    await loadAccessories();
    await loadHistory();
  }

  async function previewExcelOutbound() {
    if (!file) return;

    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");

    const form = new FormData();
    form.append("file", file);
    form.append("shipment_ref", shipmentRef || "");
    form.append("comment", comment || "");
    form.append("actor", actor);
    form.append("actor_id", actorId || "");
    form.append("preview", "1");

    const res = await apiFetch("/api/accessories/outbound/excel", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Spreadsheet preview failed");
      return;
    }

    setPreviewRows(json.rows || []);
    setPreviewType("excel");
    setPreviewOpen(true);
  }

  async function confirmExcelOutbound() {
    if (!file) return;

    setErrorMsg("");
    setSuccessMsg("");

    const form = new FormData();
    form.append("file", file);
    form.append("shipment_ref", shipmentRef || "");
    form.append("comment", comment || "");
    form.append("actor", actor);
    form.append("actor_id", actorId || "");
    form.append("preview", "0");

    const res = await apiFetch("/api/accessories/outbound/excel", {
      method: "POST",
      body: form,
    });

    const json = await res.json();

    if (!json.ok) {
      setErrorMsg(json.error || "Spreadsheet outbound failed");
      return;
    }

    closePreview();
    setSuccessMsg("Spreadsheet outbound completed");
    setFile(null);
    setShipmentRef("");
    setComment("");

    await loadAccessories();
    await loadHistory();
  }

  async function confirmPreview() {
  if (busy) return;

  setBusy(true);

  try {
    if (previewType === "manual") {
      await confirmManualOutbound();
    } else if (previewType === "excel") {
      await confirmExcelOutbound();
    }
  } finally {
    setBusy(false);
  }
}

  const filteredHistory = history.filter((h) => {
    const q = search.toLowerCase();

    return (
      h.shipment_ref?.toLowerCase().includes(q) ||
      h.accessory_name?.toLowerCase().includes(q) ||
      h.actor?.toLowerCase().includes(q) ||
      h.comment?.toLowerCase().includes(q) ||
      h.note?.toLowerCase().includes(q)
    );
  });

  return (
        <div className="space-y-10 w-full">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Accessory Outbound</h2>
        <p className="text-sm text-slate-400 mt-1">
          Process manual or spreadsheet-based accessory shipments.
        </p>
      </div>

      {busy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl flex items-center gap-3 shadow-xl">
            <div className="h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <div className="font-semibold text-sm">Processing…</div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">Preview</div>
                <div className="font-semibold text-lg">
                  Confirm Accessory Outbound
                </div>
              </div>

              <button
                onClick={closePreview}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-slate-400">
                Please review the stock changes before confirming.
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900">
                    <tr>
                      <th className="p-3 text-left">Accessory</th>
                      <th className="p-3 text-right">Quantity</th>
                      <th className="p-3 text-right">Current Stock</th>
                      <th className="p-3 text-right">Stock After</th>
                    </tr>
                  </thead>

                  <tbody>
                    {previewRows.map((row) => (
                      <tr
                        key={row.accessory_bin_id}
                        className="border-t border-slate-800"
                      >
                        <td className="p-3 font-semibold">{row.accessory}</td>
                        <td className="p-3 text-right">{row.qty}</td>
                        <td className="p-3 text-right">{row.current_stock}</td>
                        <td className="p-3 text-right">{row.after_stock}</td>
                      </tr>
                    ))}

                    {previewRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-slate-500"
                        >
                          No preview rows.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3">
  <div className="flex justify-end gap-3">
  <button
  onClick={closePreview}
  disabled={busy}
  className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
>
  Cancel
</button>

  <button
  onClick={confirmPreview}
  disabled={busy || previewRows.length === 0}
  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[180px]"
>
  {busy && (
    <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
  )}

  {busy ? "Processing…" : "Confirm Outbound"}
</button>
</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-600/20 border border-red-500 text-red-300 px-4 py-3 rounded-xl text-sm">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-600/20 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-xl text-sm">
          {successMsg}
        </div>
      )}

      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Shipment Details</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            aria-label="Accessory shipment reference"
            value={shipmentRef}
            onChange={(e) => setShipmentRef(e.target.value)}
            placeholder="Shipment reference"
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <input
            aria-label="Accessory shipment comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment"
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Manual Accessory Outbound</div>

        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-1 md:grid-cols-[1fr_160px_100px] gap-3"
            >
              <select
                aria-label={`Accessory line ${index + 1}`}
                value={line.accessory_id}
                onChange={(e) =>
                  updateLine(index, { accessory_id: e.target.value })
                }
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              >
                <option value="">Select accessory</option>
                {accessories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — stock {a.current_stock ?? 0}
                  </option>
                ))}
              </select>

              <input
                type="number"
                aria-label={`Accessory quantity ${index + 1}`}
                min={1}
                value={line.qty}
                onChange={(e) =>
                  updateLine(index, { qty: Number(e.target.value) })
                }
                className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
              />

              <button
                onClick={() => removeLine(index)}
                disabled={lines.length === 1}
                className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={addLine}
            className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Add Line
          </button>

          <button
            onClick={previewManualOutbound}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold"
          >
            Preview Outbound
          </button>
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Spreadsheet Outbound</div>

        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="file"
            aria-label="Accessory spreadsheet file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          <button
            onClick={previewExcelOutbound}
            disabled={!file}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Preview Spreadsheet
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Reads IMEI and Item Type, then calculates accessories automatically.
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="font-semibold">Accessory Outbound History</div>

          <input
            placeholder="Search outbound history"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Shipment</th>
                <th className="p-2 text-left">Accessory</th>
                <th className="p-2 text-right">Quantity</th>
                <th className="p-2 text-left">User</th>
                <th className="p-2 text-left">Comment</th>
              </tr>
            </thead>

            <tbody>
              {filteredHistory.map((h) => (
                <tr key={h.id} className="border-t border-slate-800">
                  <td className="p-2">
                    {new Date(h.created_at).toLocaleString("en-GB")}
                  </td>
                  <td className="p-2">{h.shipment_ref || "-"}</td>
                  <td className="p-2">{h.accessory_name || "-"}</td>
                  <td className="p-2 text-right">{h.qty}</td>
                  <td className="p-2">{h.actor || "-"}</td>
                  <td className="p-2">{h.comment || h.note || "-"}</td>
                </tr>
              ))}

              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-slate-500">
                    No history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
