"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";
import DispatchItemDialog, {
  fetchDispatchCatalog,
  formatDispatchDimensions,
  type DispatchCatalogItemView,
} from "@/components/DispatchItemDialog";

export default function DispatchCatalogPanel({
  onCountChange,
  onFeedback,
}: {
  onCountChange: (count: number) => void;
  onFeedback: (feedback: ProcessFeedbackValue | null) => void;
}) {
  const [items, setItems] = useState<DispatchCatalogItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<"all" | "active" | "inactive">("all");
  const [dialog, setDialog] = useState<
    { kind: "create" } | { kind: "edit"; item: DispatchCatalogItemView } | null
  >(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const rows = await fetchDispatchCatalog();
      setItems(rows);
      onCountChange(rows.length);
    } catch (error) {
      setItems([]);
      setLoadError(error instanceof Error ? error.message : "Dispatch items could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (visibility === "active" && !item.active) return false;
      if (visibility === "inactive" && item.active) return false;
      if (!query) return true;
      return [item.name, ...item.aliases].join(" ").toLowerCase().includes(query);
    });
  }, [items, search, visibility]);

  async function toggleActive(item: DispatchCatalogItemView) {
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/catalog", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, active: !item.active }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || "Dispatch item could not be updated");
      }
      await loadItems();
      onFeedback({
        kind: "success",
        title: "Dispatch item updated",
        message: `${item.name} is now ${item.active ? "inactive" : "active"}.`,
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Dispatch item could not be updated",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="packaging-inventory" aria-labelledby="dispatch-items-title">
      <div className="prototype-card prototype-table-card packaging-table-card">
        <div className="prototype-table-toolbar packaging-toolbar">
          <div>
            <h2 id="dispatch-items-title">Dispatch Items</h2>
            <p>
              Dimensions used by Dispatch Planning to calculate the packing volume. Other names are the
              Hardware Type labels Kinesis uses for the same item.
            </p>
          </div>
          <button type="button" className="prototype-button primary" onClick={() => setDialog({ kind: "create" })} disabled={Boolean(loadError)}>
            + New Dispatch Item
          </button>
        </div>

        <div className="packaging-filters">
          <label>
            <span className="sr-only">Search dispatch items</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or other name…" aria-label="Search dispatch items" />
          </label>
          <label>
            <span className="sr-only">Dispatch item visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} aria-label="Dispatch item visibility">
              <option value="all">All visibility</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </label>
          <button type="button" className="prototype-button secondary" onClick={() => void loadItems()} disabled={loading || busy}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>

        <div className="prototype-table-scroll packaging-table-scroll">
          <table className="prototype-table packaging-table">
            <thead><tr><th>Name</th><th>Dimensions</th><th>Volume</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className={!item.active ? "is-inactive" : ""}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.aliases.length > 0 ? `Also: ${item.aliases.join(" · ")}` : "No other names"}</small>
                  </td>
                  <td>{formatDispatchDimensions(item)}</td>
                  <td className="packaging-number">
                    {(item.lengthCm * item.widthCm * item.heightCm).toLocaleString("en-GB", { maximumFractionDigits: 1 })} cm³
                  </td>
                  <td>
                    <span className={`status-badge ${item.active ? "ok" : "inactive"}`}>{item.active ? "Active" : "Inactive"}</span>
                    {item.required && <small>Used by dispatch rules</small>}
                  </td>
                  <td>
                    <div className="packaging-row-actions">
                      <button type="button" onClick={() => setDialog({ kind: "edit", item })} disabled={busy}>Edit</button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(item)}
                        disabled={busy || (item.required && item.active)}
                        title={item.required && item.active ? "Used by the dispatch rules" : undefined}
                      >
                        {item.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && loadError && <tr><td colSpan={5} className="packaging-empty">{loadError}</td></tr>}
              {!loading && !loadError && filteredItems.length === 0 && <tr><td colSpan={5} className="packaging-empty">No dispatch items match these filters.</td></tr>}
              {loading && <tr><td colSpan={5} className="packaging-empty">Loading dispatch items…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="prototype-table-footer">{filteredItems.length} of {items.length} dispatch items</div>
      </div>

      {dialog && (
        <DispatchItemDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            const title = dialog.kind === "edit" ? "Dispatch item updated" : "Dispatch item created";
            setDialog(null);
            void loadItems();
            onFeedback({ kind: "success", title, message });
          }}
        />
      )}
    </section>
  );
}
