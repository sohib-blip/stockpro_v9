"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";
import {
  PACKAGING_CATEGORIES,
  formatPackagingDimensions,
  packagingCategoryLabel,
  packagingStockStatus,
  type PackagingCategory,
  type PackagingStockRow,
} from "@/lib/packaging";

type PackagingForm = {
  code: string;
  name: string;
  category: PackagingCategory;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  minimum_stock: string;
};

type AdjustmentMode = "receive" | "remove" | "set";

type PackagingHistoryRow = {
  id: string;
  movement_type: string;
  on_hand_delta: number;
  on_hand_before: number;
  on_hand_after: number;
  reserved_before: number;
  reserved_after: number;
  reason: string;
  actor_email: string;
  created_at: string;
};

const EMPTY_FORM: PackagingForm = {
  code: "",
  name: "",
  category: "BOX",
  length_cm: "",
  width_cm: "",
  height_cm: "",
  minimum_stock: "0",
};

function messageFromResponse(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function signedNumber(value: number) {
  const amount = Number(value || 0);
  return amount > 0 ? `+${amount.toLocaleString("en-GB")}` : amount.toLocaleString("en-GB");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function PackagingInventoryPanel({
  onCountChange,
  onFeedback,
}: {
  onCountChange: (count: number) => void;
  onFeedback: (feedback: ProcessFeedbackValue | null) => void;
}) {
  const [rows, setRows] = useState<PackagingStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"all" | "active" | "inactive">("all");
  const [category, setCategory] = useState<"all" | PackagingCategory>("all");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<PackagingStockRow | null>(null);
  const [form, setForm] = useState<PackagingForm>(EMPTY_FORM);
  const [adjustingRow, setAdjustingRow] = useState<PackagingStockRow | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<AdjustmentMode>("receive");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [historyTarget, setHistoryTarget] = useState<PackagingStockRow | null>(null);
  const [historyRows, setHistoryRows] = useState<PackagingHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/packaging/list?include_hidden=1&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging inventory could not be loaded"));
      }
      const nextRows = (body.rows || []) as PackagingStockRow[];
      setRows(nextRows);
      onCountChange(nextRows.length);
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging inventory could not be loaded",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [onCountChange, onFeedback]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const anyDialogOpen = Boolean(formMode || adjustingRow || historyTarget);
  useEffect(() => {
    if (!anyDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFormMode(null);
      setAdjustingRow(null);
      setHistoryTarget(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [anyDialogOpen]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (visibility === "active" && !row.active) return false;
      if (visibility === "inactive" && row.active) return false;
      if (category !== "all" && row.category !== category) return false;
      if (!query) return true;
      return `${row.name} ${row.code} ${packagingCategoryLabel(row.category)}`
        .toLowerCase()
        .includes(query);
    });
  }, [category, rows, search, visibility]);

  const totals = useMemo(() => {
    return rows.reduce(
      (summary, row) => {
        summary.onHand += row.on_hand_stock;
        summary.reserved += row.reserved_stock;
        const status = packagingStockStatus(row);
        if (row.active && (status === "LOW" || status === "EMPTY")) summary.alerts += 1;
        return summary;
      },
      { onHand: 0, reserved: 0, alerts: 0 }
    );
  }, [rows]);

  function openCreate() {
    setEditingRow(null);
    setForm(EMPTY_FORM);
    setFormMode("create");
  }

  function openEdit(row: PackagingStockRow) {
    setEditingRow(row);
    setForm({
      code: row.code,
      name: row.name,
      category: row.category,
      length_cm: String(row.length_cm),
      width_cm: String(row.width_cm),
      height_cm: String(row.height_cm),
      minimum_stock: String(row.minimum_stock),
    });
    setFormMode("edit");
  }

  async function submitFormat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    onFeedback(null);
    try {
      const payload = {
        ...(formMode === "edit" && editingRow ? { id: editingRow.id } : {}),
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        category: form.category,
        length_cm: Number(form.length_cm),
        width_cm: Number(form.width_cm),
        height_cm: Number(form.height_cm),
        minimum_stock: Number(form.minimum_stock),
      };
      const response = await apiFetch(
        formMode === "edit" ? "/api/packaging/update" : "/api/packaging/create",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging format could not be saved"));
      }
      setFormMode(null);
      await loadRows();
      onFeedback({
        kind: "success",
        title: formMode === "edit" ? "Packaging format updated" : "Packaging format created",
        message: `${payload.name} is ready in Packaging Inventory.`,
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging format could not be saved",
        message: error instanceof Error ? error.message : "Please check the entered values.",
      });
    } finally {
      setBusy(false);
    }
  }

  function openAdjustment(row: PackagingStockRow) {
    setAdjustingRow(row);
    setAdjustmentMode("receive");
    setAdjustmentQuantity("1");
    setAdjustmentReason("");
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustingRow) return;
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/packaging/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: crypto.randomUUID(),
          packaging_type_id: adjustingRow.id,
          mode: adjustmentMode,
          quantity: Number(adjustmentQuantity),
          reason: adjustmentReason.trim(),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging stock adjustment failed"));
      }
      const updatedOnHand = Number(body.row?.on_hand_stock ?? 0);
      setAdjustingRow(null);
      await loadRows();
      onFeedback({
        kind: "success",
        title: "Packaging stock updated",
        message: `${adjustingRow.name} now has ${updatedOnHand.toLocaleString("en-GB")} units on hand.`,
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging stock adjustment failed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(row: PackagingStockRow) {
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/packaging/toggle-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, active: !row.active }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging visibility could not be updated"));
      }
      await loadRows();
      onFeedback({
        kind: "success",
        title: "Packaging visibility updated",
        message: `${row.name} is now ${row.active ? "inactive" : "active"}.`,
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging visibility could not be updated",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function openHistory(row: PackagingStockRow) {
    setHistoryTarget(row);
    setHistoryRows([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const response = await apiFetch(
        `/api/packaging/history?packaging_type_id=${encodeURIComponent(row.id)}&limit=200&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging history could not be loaded"));
      }
      setHistoryRows(body.rows || []);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Packaging history could not be loaded");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <section className="packaging-inventory" aria-labelledby="packaging-inventory-title">
      <div className="prototype-kpi-grid packaging-kpi-grid">
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">Packaging formats</div>
          <div className="prototype-kpi-value">{rows.length.toLocaleString("en-GB")}</div>
          <div className="prototype-kpi-caption">boxes and envelopes configured</div>
        </article>
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">On-hand packaging</div>
          <div className="prototype-kpi-value">{totals.onHand.toLocaleString("en-GB")}</div>
          <div className="prototype-kpi-caption">physical units recorded</div>
        </article>
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">Reserved packaging</div>
          <div className="prototype-kpi-value">{totals.reserved.toLocaleString("en-GB")}</div>
          <div className="prototype-kpi-caption">units reserved for future dispatch</div>
        </article>
        <article className={`prototype-kpi-card${totals.alerts ? " is-alert" : ""}`}>
          <div className="prototype-eyebrow">Stock alerts</div>
          <div className="prototype-kpi-value">{totals.alerts.toLocaleString("en-GB")}</div>
          <div className="prototype-kpi-caption">active formats low or empty</div>
        </article>
      </div>

      <div className="prototype-card prototype-table-card packaging-table-card">
        <div className="prototype-table-toolbar packaging-toolbar">
          <div>
            <h2 id="packaging-inventory-title">Packaging Inventory</h2>
            <p>Manage packaging dimensions, stock thresholds and auditable count adjustments.</p>
          </div>
          <button type="button" className="prototype-button primary" onClick={openCreate}>
            + New Packaging Format
          </button>
        </div>

        <div className="packaging-filters">
          <label>
            <span className="sr-only">Search packaging</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or code…"
              aria-label="Search packaging"
            />
          </label>
          <label>
            <span className="sr-only">Packaging category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as "all" | PackagingCategory)} aria-label="Packaging category">
              <option value="all">All types</option>
              {PACKAGING_CATEGORIES.map((value) => (
                <option key={value} value={value}>{packagingCategoryLabel(value)}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Packaging visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} aria-label="Packaging visibility">
              <option value="all">All visibility</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <button type="button" className="prototype-button secondary" onClick={() => void loadRows()} disabled={loading || busy}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="prototype-table-scroll packaging-table-scroll">
          <table className="prototype-table packaging-table">
            <thead>
              <tr>
                <th>Packaging</th>
                <th>Type</th>
                <th>Dimensions</th>
                <th>On Hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Minimum</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const status = packagingStockStatus(row);
                return (
                  <tr key={row.id} className={`stock-row ${status === "EMPTY" ? "critical" : status === "LOW" ? "low" : ""}`}>
                    <td><strong>{row.name}</strong><small>{row.code}</small></td>
                    <td>{packagingCategoryLabel(row.category)}</td>
                    <td>{formatPackagingDimensions(row)}</td>
                    <td className="packaging-number">{row.on_hand_stock.toLocaleString("en-GB")}</td>
                    <td className="packaging-number">{row.reserved_stock.toLocaleString("en-GB")}</td>
                    <td className="packaging-number"><strong>{row.available_stock.toLocaleString("en-GB")}</strong></td>
                    <td className="packaging-number">{row.minimum_stock.toLocaleString("en-GB")}</td>
                    <td><span className={`status-badge ${status === "OK" ? "ok" : status === "LOW" ? "low" : status === "EMPTY" ? "critical" : "inactive"}`}>{status}</span></td>
                    <td>
                      <div className="packaging-row-actions">
                        <button type="button" onClick={() => openAdjustment(row)} disabled={busy || !row.active}>Adjust</button>
                        <button type="button" onClick={() => void openHistory(row)} disabled={busy}>History</button>
                        <button type="button" onClick={() => openEdit(row)} disabled={busy}>Edit</button>
                        <button type="button" onClick={() => void toggleVisibility(row)} disabled={busy}>{row.active ? "Deactivate" : "Activate"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredRows.length === 0 && (
                <tr><td colSpan={9} className="packaging-empty">No packaging formats match these filters.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} className="packaging-empty">Loading packaging inventory…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="prototype-table-footer">{filteredRows.length} of {rows.length} packaging formats</div>
      </div>

      {formMode && (
        <div className="packaging-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setFormMode(null); }}>
          <section className="packaging-dialog" role="dialog" aria-modal="true" aria-labelledby="packaging-format-dialog-title">
            <header className="packaging-dialog-header">
              <div><span>Inventory setup</span><h2 id="packaging-format-dialog-title">{formMode === "edit" ? "Edit Packaging Format" : "New Packaging Format"}</h2><p>Dimensions are in centimetres. Stock is changed separately to preserve its audit history.</p></div>
              <button type="button" aria-label="Close" onClick={() => setFormMode(null)} disabled={busy}>×</button>
            </header>
            <form className="packaging-dialog-form" onSubmit={submitFormat}>
              <label className="packaging-field packaging-field-wide"><span>Name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Radius Box Medium" autoFocus /></label>
              <label className="packaging-field"><span>Code</span><input required maxLength={50} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="e.g. RADIUS-M" /></label>
              <label className="packaging-field"><span>Type</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as PackagingCategory })}>{PACKAGING_CATEGORIES.map((value) => <option key={value} value={value}>{packagingCategoryLabel(value)}</option>)}</select></label>
              <fieldset className="packaging-dimensions packaging-field-wide"><legend>Outer dimensions (cm)</legend><label><span>Length</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.length_cm} onChange={(event) => setForm({ ...form, length_cm: event.target.value })} /></label><span aria-hidden="true">×</span><label><span>Width</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.width_cm} onChange={(event) => setForm({ ...form, width_cm: event.target.value })} /></label><span aria-hidden="true">×</span><label><span>Height</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.height_cm} onChange={(event) => setForm({ ...form, height_cm: event.target.value })} /></label></fieldset>
              <label className="packaging-field packaging-field-wide"><span>Minimum stock alert</span><input required type="number" min="0" max="10000000" step="1" value={form.minimum_stock} onChange={(event) => setForm({ ...form, minimum_stock: event.target.value })} /><small>An alert appears when available stock reaches this value.</small></label>
              <footer className="packaging-dialog-actions"><button type="button" className="prototype-button secondary" onClick={() => setFormMode(null)} disabled={busy}>Cancel</button><button type="submit" className="prototype-button primary" disabled={busy}>{busy ? "Saving…" : "Save Packaging Format"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {adjustingRow && (
        <div className="packaging-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAdjustingRow(null); }}>
          <section className="packaging-dialog packaging-adjust-dialog" role="dialog" aria-modal="true" aria-labelledby="packaging-adjust-dialog-title">
            <header className="packaging-dialog-header"><div><span>Audited stock change</span><h2 id="packaging-adjust-dialog-title">Adjust {adjustingRow.name}</h2><p>{adjustingRow.code} · Current on hand: {adjustingRow.on_hand_stock.toLocaleString("en-GB")} · Reserved: {adjustingRow.reserved_stock.toLocaleString("en-GB")}</p></div><button type="button" aria-label="Close" onClick={() => setAdjustingRow(null)} disabled={busy}>×</button></header>
            <form className="packaging-dialog-form" onSubmit={submitAdjustment}>
              <label className="packaging-field"><span>Adjustment</span><select value={adjustmentMode} onChange={(event) => setAdjustmentMode(event.target.value as AdjustmentMode)}><option value="receive">Receive stock</option><option value="remove">Remove stock</option><option value="set">Set counted stock</option></select></label>
              <label className="packaging-field"><span>{adjustmentMode === "set" ? "New on-hand count" : "Quantity"}</span><input required type="number" min={adjustmentMode === "set" ? "0" : "1"} max="10000000" step="1" value={adjustmentQuantity} onChange={(event) => setAdjustmentQuantity(event.target.value)} /></label>
              <label className="packaging-field packaging-field-wide"><span>Reason</span><textarea required maxLength={500} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="e.g. Delivery received from packaging supplier" autoFocus /><small>Required for the stock audit history.</small></label>
              <footer className="packaging-dialog-actions"><button type="button" className="prototype-button secondary" onClick={() => setAdjustingRow(null)} disabled={busy}>Cancel</button><button type="submit" className="prototype-button primary" disabled={busy || !adjustmentReason.trim()}>{busy ? "Applying…" : "Confirm Stock Adjustment"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {historyTarget && (
        <div className="packaging-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryTarget(null); }}>
          <section className="packaging-dialog packaging-history-dialog" role="dialog" aria-modal="true" aria-labelledby="packaging-history-dialog-title">
            <header className="packaging-dialog-header"><div><span>Packaging audit trail</span><h2 id="packaging-history-dialog-title">{historyTarget.name} History</h2><p>{historyTarget.code} · {formatPackagingDimensions(historyTarget)}</p></div><button type="button" aria-label="Close" onClick={() => setHistoryTarget(null)}>×</button></header>
            <div className="packaging-history-scroll">
              {historyLoading ? <div className="packaging-history-state">Loading packaging history…</div> : historyError ? <div className="packaging-history-state is-error">{historyError}</div> : (
                <table><thead><tr><th>Date and Time</th><th>Change</th><th>On Hand</th><th>Reserved</th><th>User</th><th>Reason</th></tr></thead><tbody>{historyRows.map((movement) => <tr key={movement.id}><td>{formatDate(movement.created_at)}</td><td><span className={`packaging-delta ${movement.on_hand_delta > 0 ? "is-positive" : "is-negative"}`}>{movement.movement_type.replaceAll("_", " ")} {signedNumber(movement.on_hand_delta)}</span></td><td>{movement.on_hand_before.toLocaleString("en-GB")} → {movement.on_hand_after.toLocaleString("en-GB")}</td><td>{movement.reserved_before.toLocaleString("en-GB")} → {movement.reserved_after.toLocaleString("en-GB")}</td><td>{movement.actor_email}</td><td>{movement.reason}</td></tr>)}{historyRows.length === 0 && <tr><td colSpan={6} className="packaging-empty">No stock movements have been recorded for this format.</td></tr>}</tbody></table>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
