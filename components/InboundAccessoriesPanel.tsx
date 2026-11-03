"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { MAX_INCLUDED_PER_DEVICE } from "@/lib/inbound-accessories";

type IncludedRow = {
  id: string;
  accessory_bin_id: string;
  accessory: string;
  active: boolean;
  quantity: number;
};

function errorMessage(body: unknown, fallback: string) {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

// Inventory Setup > Included at inbound: accessories delivered in the box
// with this device model, added to accessory stock when it is received.
// Separate from the automatic outbound rules above (WIPE, pads and guides
// are not in the box).
export default function InboundAccessoriesPanel({
  device,
  accessories,
  onError,
  onSuccess,
}: {
  device: { id: string; name: string };
  accessories: Array<{ id: string; name: string }>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [rows, setRows] = useState<IncludedRow[]>([]);
  const [accessoryId, setAccessoryId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  // The parent's callbacks change on every render; loading only follows the device.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    const response = await apiFetch(
      `/api/bins/inbound-accessories?device_id=${device.id}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setRows(body.rows || []);
    else onErrorRef.current(errorMessage(body, "Included accessories could not be loaded"));
  }, [device.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!accessoryId) return;
    setBusy(true);
    try {
      const response = await apiFetch("/api/bins/inbound-accessories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: device.id, accessory_bin_id: accessoryId, quantity }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(errorMessage(body, "Included accessory could not be saved"));
      setAccessoryId("");
      setQuantity(1);
      await load();
      onSuccess("Included accessory saved.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Included accessory could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: IncludedRow) {
    setBusy(true);
    try {
      const response = await apiFetch("/api/bins/inbound-accessories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(errorMessage(body, "Included accessory could not be deleted"));
      await load();
      onSuccess("Included accessory deleted.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Included accessory could not be deleted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inbound-accessories-panel">
      <div className="inbound-accessories-heading">
        <strong>{`Included at inbound for ${device.name}`}</strong>
        <p>Accessories delivered in the box with this device. When it is received, they are added to accessory stock automatically.</p>
      </div>

      <div className="inbound-accessories-form">
        <label>
          <span>Accessory</span>
          <select aria-label="Included accessory" value={accessoryId} onChange={(event) => setAccessoryId(event.target.value)}>
            <option value="">Select an accessory</option>
            {accessories.map((accessory) => (
              <option key={accessory.id} value={accessory.id}>{accessory.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Quantity per device</span>
          <input
            aria-label="Included quantity per device"
            type="number"
            min={1}
            max={MAX_INCLUDED_PER_DEVICE}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <button type="button" className="prototype-button primary" onClick={() => void add()} disabled={busy || !accessoryId}>
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="inbound-accessories-empty">No included accessories.</p>
      ) : (
        <ul className="inbound-accessories-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span>{row.accessory}{row.active ? "" : " (hidden)"}</span>
              <strong>{`${row.quantity} per device`}</strong>
              <button type="button" onClick={() => void remove(row)} disabled={busy}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
