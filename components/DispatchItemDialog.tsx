"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

export type DispatchCatalogItemView = {
  id: string;
  name: string;
  aliases: string[];
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  active: boolean;
  required: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

type DialogMode =
  | { kind: "create" }
  | { kind: "edit"; item: DispatchCatalogItemView }
  // An unknown Kinesis label from Dispatch Planning: link it to an existing
  // item or create a new item for it.
  | { kind: "resolve"; label: string; hardwareType?: string; deviceType?: string };

type ItemForm = {
  name: string;
  aliases: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

function messageFromResponse(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export function formatDispatchDimensions(item: {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}) {
  const format = (value: number) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
  return `${format(item.lengthCm)} × ${format(item.widthCm)} × ${format(item.heightCm)} cm`;
}

export async function fetchDispatchCatalog(): Promise<DispatchCatalogItemView[]> {
  const response = await apiFetch(`/api/dispatch-planning/catalog?t=${Date.now()}`, {
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(messageFromResponse(body, "Dispatch items could not be loaded"));
  }
  return (body.items || []) as DispatchCatalogItemView[];
}

export default function DispatchItemDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: DialogMode;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = mode.kind === "edit" ? mode.item : null;
  const [form, setForm] = useState<ItemForm>({
    name: editing?.name ?? (mode.kind === "resolve" ? mode.label : ""),
    aliases: editing?.aliases.join("\n") ?? "",
    lengthCm: editing ? String(editing.lengthCm) : "",
    widthCm: editing ? String(editing.widthCm) : "",
    heightCm: editing ? String(editing.heightCm) : "",
  });
  const [resolveChoice, setResolveChoice] = useState<"link" | "create">("link");
  const [linkItemId, setLinkItemId] = useState("");
  const [items, setItems] = useState<DispatchCatalogItemView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode.kind !== "resolve") return;
    fetchDispatchCatalog()
      .then((rows) => setItems(rows.filter((row) => row.active)))
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Dispatch items could not be loaded")
      );
  }, [mode.kind]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose]);

  async function send(method: "POST" | "PATCH", payload: Record<string, unknown>) {
    const response = await apiFetch("/api/dispatch-planning/catalog", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      throw new Error(messageFromResponse(body, "Dispatch item could not be saved"));
    }
    return body.item as DispatchCatalogItemView;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode.kind === "resolve" && resolveChoice === "link") {
        if (!linkItemId) throw new Error("Choose the item this label refers to");
        const item = await send("PATCH", { id: linkItemId, add_alias: mode.label });
        onSaved(`"${mode.label}" now uses the dimensions of ${item.name}.`);
        return;
      }

      const payload = {
        name: form.name,
        aliases: form.aliases.split("\n"),
        lengthCm: form.lengthCm,
        widthCm: form.widthCm,
        heightCm: form.heightCm,
      };
      const item = editing
        ? await send("PATCH", { id: editing.id, ...payload })
        : await send("POST", payload);
      onSaved(
        editing
          ? `${item.name} was updated.`
          : `${item.name} was added with ${formatDispatchDimensions(item)}.`
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Dispatch item could not be saved");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode.kind === "edit"
      ? "Edit Dispatch Item"
      : mode.kind === "resolve"
        ? "Add Dimensions"
        : "New Dispatch Item";
  const showItemFields = mode.kind !== "resolve" || resolveChoice === "create";

  return (
    <div
      className="packaging-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="packaging-dialog" role="dialog" aria-modal="true" aria-labelledby="dispatch-item-dialog-title">
        <header className="packaging-dialog-header">
          <div>
            <span>Dispatch planning</span>
            <h2 id="dispatch-item-dialog-title">{title}</h2>
            <p>
              {mode.kind === "resolve"
                ? `"${mode.label}" has no dimensions yet. Link it to a known item or create a new item.`
                : "Dimensions are used to calculate the packing volume of each order."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </header>

        <form className="packaging-dialog-form" onSubmit={submit}>
          {mode.kind === "resolve" && (
            <fieldset className="dispatch-resolve-options packaging-field-wide">
              <legend className="sr-only">How should this label be resolved?</legend>
              {(mode.hardwareType || mode.deviceType) && (
                <small>
                  Hardware Type: {mode.hardwareType || "—"} · Device Type: {mode.deviceType || "—"}
                </small>
              )}
              <label className="dispatch-resolve-choice">
                <input
                  type="radio"
                  name="dispatch-resolve-choice"
                  checked={resolveChoice === "link"}
                  onChange={() => setResolveChoice("link")}
                />{" "}
                Same item as an existing one (another name for it)
              </label>
              {resolveChoice === "link" && (
                <select
                  aria-label="Existing dispatch item"
                  value={linkItemId}
                  onChange={(event) => setLinkItemId(event.target.value)}
                >
                  <option value="">Select an item…</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {formatDispatchDimensions(item)}
                    </option>
                  ))}
                </select>
              )}
              <label className="dispatch-resolve-choice">
                <input
                  type="radio"
                  name="dispatch-resolve-choice"
                  checked={resolveChoice === "create"}
                  onChange={() => setResolveChoice("create")}
                />{" "}
                New item with its own dimensions
              </label>
            </fieldset>
          )}

          {showItemFields && (
            <>
              <label className="packaging-field packaging-field-wide">
                <span>Name</span>
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  disabled={Boolean(editing?.required)}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  autoFocus={mode.kind !== "edit"}
                />
                {editing?.required && <small>Used by the dispatch rules: the name cannot change.</small>}
              </label>
              <fieldset className="packaging-dimensions packaging-field-wide">
                <legend>Dimensions (cm)</legend>
                <label><span>Length</span><input required type="number" min="0" max="1000" step="0.01" value={form.lengthCm} onChange={(event) => setForm({ ...form, lengthCm: event.target.value })} /></label>
                <span aria-hidden="true">×</span>
                <label><span>Width</span><input required type="number" min="0" max="1000" step="0.01" value={form.widthCm} onChange={(event) => setForm({ ...form, widthCm: event.target.value })} /></label>
                <span aria-hidden="true">×</span>
                <label><span>Height</span><input required type="number" min="0" max="1000" step="0.01" value={form.heightCm} onChange={(event) => setForm({ ...form, heightCm: event.target.value })} /></label>
              </fieldset>
              {mode.kind !== "resolve" && (
                <label className="packaging-field packaging-field-wide">
                  <span>Other names</span>
                  <textarea
                    rows={3}
                    value={form.aliases}
                    onChange={(event) => setForm({ ...form, aliases: event.target.value })}
                    placeholder="One Kinesis Hardware Type per line, e.g. DVR-4CH"
                  />
                  <small>Other Hardware Type labels Kinesis uses for this same item.</small>
                </label>
              )}
            </>
          )}

          {error && (
            <div className="dashboard-imei-error packaging-field-wide" role="alert">
              {error}
            </div>
          )}

          <footer className="packaging-dialog-actions">
            <button type="button" className="prototype-button secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="prototype-button primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
