"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
    const res = await fetch(`/api/accessory-bins/list?t=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) setAccessories(json.rows || []);
  }

  async function loadHistory() {
    const res = await fetch(
      `/api/accessories/outbound/history?t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();
    if (json.ok) setHistory(json.rows || []);
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

    const res = await fetch("/api/accessories/outbound/manual", {
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

    const res = await fetch("/api/accessories/outbound/manual", {
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
    setSuccessMsg("Accessories outbound confirmed");
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

    const res = await fetch("/api/accessories/outbound/excel", {
      method: "POST",
      body: form,
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Excel preview failed");
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

    const res = await fetch("/api/accessories/outbound/excel", {
      method: "POST",
      body: form,
    });

    const json = await res.json();

    if (!json.ok) {
      setErrorMsg(json.error || "Excel outbound failed");
      return;
    }

    closePreview();
    setSuccessMsg("Excel outbound imported");
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
    <div className="w-full">
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Accessories</div>
          <h1 className="sp-title">Accessories Outbound</h1>
          <p className="sp-desc">
            Manual outbound, Excel outbound and history for accessories.
          </p>
        </div>
      </div>

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="sp-card sp-card-tight flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-sp-primary border-t-transparent" />
            <div className="text-sm font-semibold text-sp-text">Processing...</div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="sp-card w-full max-w-3xl space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-sp-border pb-4">
              <div>
                <div className="sp-eyebrow">Preview</div>
                <div className="text-lg font-semibold text-sp-text">
                  Confirm accessories outbound
                </div>
              </div>

              <button onClick={closePreview} className="sp-btn sp-btn-ghost">
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div className="text-sm text-sp-muted">
                Please review the stock changes before confirming.
              </div>

              <div className="overflow-x-auto rounded-lg border border-sp-border">
                <table className="sp-table">
                  <thead>
                    <tr>
                      <th>Accessory</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Current stock</th>
                      <th className="text-right">After</th>
                    </tr>
                  </thead>

                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.accessory_bin_id}>
                        <td className="font-semibold">{row.accessory}</td>
                        <td className="text-right">{row.qty}</td>
                        <td className="text-right">{row.current_stock}</td>
                        <td className="text-right">{row.after_stock}</td>
                      </tr>
                    ))}

                    {previewRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center text-sp-muted">
                          No preview rows.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={closePreview}
                  disabled={busy}
                  className="sp-btn sp-btn-ghost"
                >
                  Cancel
                </button>

                <button
                  onClick={confirmPreview}
                  disabled={busy || previewRows.length === 0}
                  className="sp-btn sp-btn-primary min-w-[180px]"
                >
                  {busy && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  {busy ? "Processing..." : "Confirm outbound"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {errorMsg && <div className="sp-alert sp-alert-err">{errorMsg}</div>}

        {successMsg && <div className="sp-alert sp-alert-ok">{successMsg}</div>}

        <div className="sp-card space-y-4">
          <div className="font-semibold text-sp-text">Shipment</div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <input
              value={shipmentRef}
              onChange={(e) => setShipmentRef(e.target.value)}
              placeholder="Shipment reference..."
              className="sp-input"
            />

            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment optional..."
              className="sp-input"
            />
          </div>
        </div>

        <div className="sp-card space-y-4">
          <div className="font-semibold text-sp-text">Manual Outbound</div>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px_100px]"
              >
                <select
                  value={line.accessory_id}
                  onChange={(e) =>
                    updateLine(index, { accessory_id: e.target.value })
                  }
                  className="sp-select"
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
                  min={1}
                  value={line.qty}
                  onChange={(e) =>
                    updateLine(index, { qty: Number(e.target.value) })
                  }
                  className="sp-input"
                />

                <button
                  onClick={() => removeLine(index)}
                  disabled={lines.length === 1}
                  className="sp-btn sp-btn-ghost border-[var(--sp-err-border)] text-[var(--sp-err-text)] hover:bg-[var(--sp-err-soft)]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={addLine} className="sp-btn sp-btn-ghost">
              + Add line
            </button>

            <button
              onClick={previewManualOutbound}
              className="sp-btn sp-btn-primary"
            >
              Preview Shipment
            </button>
          </div>
        </div>

        <div className="sp-card space-y-4">
          <div className="font-semibold text-sp-text">Excel Outbound</div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="sp-input max-w-md"
            />

            <button
              onClick={previewExcelOutbound}
              disabled={!file}
              className="sp-btn sp-btn-primary"
            >
              Preview Excel
            </button>
          </div>

          <div className="text-xs text-sp-muted">
            Reads IMEI and Item Type, then calculates accessories automatically.
          </div>
        </div>

        <div className="sp-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold text-sp-text">History</div>

            <input
              placeholder="Search history..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sp-input max-w-xs"
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-sp-border">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Shipment</th>
                  <th>Accessory</th>
                  <th className="text-right">Qty</th>
                  <th>User</th>
                  <th>Comment</th>
                </tr>
              </thead>

              <tbody>
                {filteredHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.created_at).toLocaleString()}</td>
                    <td>{h.shipment_ref || "-"}</td>
                    <td>{h.accessory_name || "-"}</td>
                    <td className="text-right">{h.qty}</td>
                    <td>{h.actor || "-"}</td>
                    <td>{h.comment || h.note || "-"}</td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-sp-muted">
                      No history yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
