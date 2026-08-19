"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";
import {
  PACKAGING_CATEGORIES,
  formatPackagingDimensions,
  packagingCategoryLabel,
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
};

const EMPTY_FORM: PackagingForm = {
  code: "",
  name: "",
  category: "BOX",
  length_cm: "",
  width_cm: "",
  height_cm: "",
};

function messageFromResponse(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
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

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/packaging/list?include_hidden=1&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "Packaging formats could not be loaded"));
      }
      const nextRows = (body.rows || []) as PackagingStockRow[];
      setRows(nextRows);
      onCountChange(nextRows.length);
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging formats could not be loaded",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [onCountChange, onFeedback]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!formMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFormMode(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [formMode]);

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
        minimum_stock: editingRow?.minimum_stock ?? 0,
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

  return (
    <section className="packaging-inventory" aria-labelledby="packaging-inventory-title">
      <div className="prototype-card prototype-table-card packaging-table-card">
        <div className="prototype-table-toolbar packaging-toolbar">
          <div>
            <h2 id="packaging-inventory-title">Packaging Formats</h2>
            <p>Create formats and maintain their names, dimensions and availability.</p>
          </div>
          <button type="button" className="prototype-button primary" onClick={openCreate}>
            + New Packaging Format
          </button>
        </div>

        <div className="packaging-filters">
          <label>
            <span className="sr-only">Search packaging</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or code…" aria-label="Search packaging" />
          </label>
          <label>
            <span className="sr-only">Packaging category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as "all" | PackagingCategory)} aria-label="Packaging category">
              <option value="all">All types</option>
              {PACKAGING_CATEGORIES.map((value) => <option key={value} value={value}>{packagingCategoryLabel(value)}</option>)}
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
          <button type="button" className="prototype-button secondary" onClick={() => void loadRows()} disabled={loading || busy}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>

        <div className="prototype-table-scroll packaging-table-scroll">
          <table className="prototype-table packaging-table">
            <thead><tr><th>Name</th><th>Dimensions</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className={!row.active ? "is-inactive" : ""}>
                  <td><strong>{row.name}</strong><small>{row.code} · {packagingCategoryLabel(row.category)} · {row.active ? "Active" : "Inactive"}</small></td>
                  <td>{formatPackagingDimensions(row)}</td>
                  <td><div className="packaging-row-actions"><button type="button" onClick={() => openEdit(row)} disabled={busy}>Edit</button><button type="button" onClick={() => void toggleVisibility(row)} disabled={busy}>{row.active ? "Deactivate" : "Activate"}</button></div></td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && <tr><td colSpan={3} className="packaging-empty">No packaging formats match these filters.</td></tr>}
              {loading && <tr><td colSpan={3} className="packaging-empty">Loading packaging formats…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="prototype-table-footer">{filteredRows.length} of {rows.length} packaging formats</div>
      </div>

      {formMode && (
        <div className="packaging-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setFormMode(null); }}>
          <section className="packaging-dialog" role="dialog" aria-modal="true" aria-labelledby="packaging-format-dialog-title">
            <header className="packaging-dialog-header">
              <div><span>Inventory setup</span><h2 id="packaging-format-dialog-title">{formMode === "edit" ? "Edit Packaging Format" : "New Packaging Format"}</h2><p>Define the package identity and its outer dimensions in centimetres.</p></div>
              <button type="button" aria-label="Close" onClick={() => setFormMode(null)} disabled={busy}>×</button>
            </header>
            <form className="packaging-dialog-form" onSubmit={submitFormat}>
              <label className="packaging-field packaging-field-wide"><span>Name</span><input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Radius Box Medium" autoFocus /></label>
              <label className="packaging-field"><span>Code</span><input required maxLength={50} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="e.g. RADIUS-M" /></label>
              <label className="packaging-field"><span>Type</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as PackagingCategory })}>{PACKAGING_CATEGORIES.map((value) => <option key={value} value={value}>{packagingCategoryLabel(value)}</option>)}</select></label>
              <fieldset className="packaging-dimensions packaging-field-wide"><legend>Outer dimensions (cm)</legend><label><span>Length</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.length_cm} onChange={(event) => setForm({ ...form, length_cm: event.target.value })} /></label><span aria-hidden="true">×</span><label><span>Width</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.width_cm} onChange={(event) => setForm({ ...form, width_cm: event.target.value })} /></label><span aria-hidden="true">×</span><label><span>Height</span><input required type="number" min="0.01" max="1000" step="0.01" value={form.height_cm} onChange={(event) => setForm({ ...form, height_cm: event.target.value })} /></label></fieldset>
              <footer className="packaging-dialog-actions"><button type="button" className="prototype-button secondary" onClick={() => setFormMode(null)} disabled={busy}>Cancel</button><button type="submit" className="prototype-button primary" disabled={busy}>{busy ? "Saving…" : "Save Packaging Format"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
