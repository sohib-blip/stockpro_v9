"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

type InventoryRecord = {
  kind: "device" | "accessory";
  id: string;
  name: string;
  label: string;
  active: boolean;
  category: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  kinesisNames: string[];
};

type DimensionFields = { lengthCm: string; widthCm: string; heightCm: string };

const EMPTY_DIMENSIONS: DimensionFields = { lengthCm: "", widthCm: "", heightCm: "" };
const NEW_ACCESSORY = "new";

// Same normalisation as dispatchItemKey, kept here so the dialog does not pull
// the workbook parser into the browser bundle.
function labelKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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

function recordValue(record: InventoryRecord) {
  return `${record.kind}:${record.id}`;
}

function dimensionsOf(record: InventoryRecord | undefined): DimensionFields {
  if (!record || record.lengthCm === null) return EMPTY_DIMENSIONS;
  return {
    lengthCm: String(record.lengthCm),
    widthCm: String(record.widthCm),
    heightCm: String(record.heightCm),
  };
}

function optionText(record: InventoryRecord) {
  const dimensions =
    record.lengthCm === null
      ? "no dimensions"
      : formatDispatchDimensions({
          lengthCm: record.lengthCm,
          widthCm: Number(record.widthCm),
          heightCm: Number(record.heightCm),
        });
  return `${record.label}${record.active ? "" : " (hidden)"} · ${dimensions}`;
}

// Resolves an unknown Kinesis label from Dispatch Planning by storing its
// dimensions on the matching device or accessory record.
export default function DispatchItemDialog({
  label,
  hardwareType,
  deviceType,
  onClose,
  onSaved,
}: {
  label: string;
  hardwareType?: string;
  deviceType?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [selection, setSelection] = useState("");
  const [dimensions, setDimensions] = useState<DimensionFields>(EMPTY_DIMENSIONS);
  const [category, setCategory] = useState("Items");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/dispatch-planning/items?t=${Date.now()}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) {
          throw new Error(messageFromResponse(body, "Device and accessory records could not be loaded"));
        }
        if (cancelled) return;
        const loaded = (body.items || []) as InventoryRecord[];
        setRecords(loaded);
        const key = labelKey(label);
        const match = loaded.find((record) =>
          [record.name, record.label, ...record.kinesisNames].some((value) => labelKey(value) === key)
        );
        if (match) {
          setSelection(recordValue(match));
          setDimensions(dimensionsOf(match));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Device and accessory records could not be loaded");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [label]);

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

  const devices = useMemo(() => records.filter((record) => record.kind === "device"), [records]);
  const accessories = useMemo(() => records.filter((record) => record.kind === "accessory"), [records]);

  function choose(value: string) {
    setSelection(value);
    setDimensions(dimensionsOf(records.find((record) => recordValue(record) === value)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection) {
      setError("Choose the device or accessory this label refers to");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const [kind, id] = selection.split(":");
      const response = await apiFetch("/api/dispatch-planning/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          target: selection === NEW_ACCESSORY ? { kind: "new_accessory", category } : { kind, id },
          ...dimensions,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(messageFromResponse(body, "The dimensions could not be saved"));
      }
      onSaved(String(body.message || "Dimensions saved."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The dimensions could not be saved");
    } finally {
      setBusy(false);
    }
  }

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
            <h2 id="dispatch-item-dialog-title">Add Dimensions</h2>
            <p>{`"${label}" has no dimensions yet. Choose the matching device or accessory and enter its dimensions.`}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </header>

        <form className="packaging-dialog-form" onSubmit={submit}>
          {(hardwareType || deviceType) && (
            <small className="packaging-field-wide dispatch-resolve-context">
              Hardware Type: {hardwareType || "—"} · Device Type: {deviceType || "—"}
            </small>
          )}

          <label className="packaging-field packaging-field-wide">
            <span>Device or accessory</span>
            <select
              aria-label="Device or accessory"
              value={selection}
              disabled={loading}
              onChange={(event) => choose(event.target.value)}
            >
              <option value="">{loading ? "Loading…" : "Select a device or accessory…"}</option>
              <optgroup label="Device Bins">
                {devices.map((record) => (
                  <option key={recordValue(record)} value={recordValue(record)}>{optionText(record)}</option>
                ))}
              </optgroup>
              <optgroup label="Accessory Inventory">
                {accessories.map((record) => (
                  <option key={recordValue(record)} value={recordValue(record)}>{optionText(record)}</option>
                ))}
              </optgroup>
              <option value={NEW_ACCESSORY}>+ Create a new hidden accessory</option>
            </select>
            <small>The label is remembered on this record, so the next workbooks are recognised automatically.</small>
          </label>

          {selection === NEW_ACCESSORY && (
            <label className="packaging-field packaging-field-wide">
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {["Items", "Consumables", "Harness", "Vision"].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          )}

          <fieldset className="packaging-dimensions packaging-field-wide">
            <legend>Dimensions (cm)</legend>
            <label><span>Length</span><input required type="number" min="0" max="1000" step="0.01" value={dimensions.lengthCm} onChange={(event) => setDimensions({ ...dimensions, lengthCm: event.target.value })} /></label>
            <span aria-hidden="true">×</span>
            <label><span>Width</span><input required type="number" min="0" max="1000" step="0.01" value={dimensions.widthCm} onChange={(event) => setDimensions({ ...dimensions, widthCm: event.target.value })} /></label>
            <span aria-hidden="true">×</span>
            <label><span>Height</span><input required type="number" min="0" max="1000" step="0.01" value={dimensions.heightCm} onChange={(event) => setDimensions({ ...dimensions, heightCm: event.target.value })} /></label>
          </fieldset>

          {error && (
            <div className="dashboard-imei-error packaging-field-wide" role="alert">
              {error}
            </div>
          )}

          <footer className="packaging-dialog-actions">
            <button type="button" className="prototype-button secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="prototype-button primary" disabled={busy || loading}>
              {busy ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
