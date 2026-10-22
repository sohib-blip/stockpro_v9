"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";
import { isPackagingContainer, type PackagingStockRow } from "@/lib/packaging";

type PackagingRule = {
  id: string;
  trigger_kind: "packaging" | "device";
  trigger_id: string;
  trigger_name: string;
  packaging_type_id: string;
  packaging_name: string;
  quantity: number;
};

type Device = { id: string; name: string };

function errorMessage(body: unknown, fallback: string) {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

// Extra packaging removed automatically with a dispatch: for every package of
// a format (Radius Box Small -> Small Sleeve) or every device of a model.
export default function PackagingRulesPanel({
  packaging,
  onFeedback,
}: {
  packaging: PackagingStockRow[];
  onFeedback: (feedback: ProcessFeedbackValue | null) => void;
}) {
  const [rules, setRules] = useState<PackagingRule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState("");
  const [packagingTypeId, setPackagingTypeId] = useState("");
  const [quantity, setQuantity] = useState("1");

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/packaging/rules?t=${Date.now()}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(errorMessage(body, "Packaging rules could not be loaded"));
      }
      setRules(body.rules || []);
      setDevices(body.devices || []);
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging rules could not be loaded",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [onFeedback]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const activePackaging = useMemo(
    () => packaging.filter((row) => row.active),
    [packaging]
  );
  const containers = activePackaging.filter((row) => isPackagingContainer(row.category));
  const [triggerKind, triggerId] = trigger.split(":");
  const targets = activePackaging.filter(
    (row) => !(triggerKind === "packaging" && row.id === triggerId)
  );

  async function saveRule() {
    if (!triggerKind || !triggerId || !packagingTypeId) return;
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/packaging/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: { kind: triggerKind, id: triggerId },
          packaging_type_id: packagingTypeId,
          quantity: Number(quantity),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(errorMessage(body, "Packaging rule could not be saved"));
      }
      setPackagingTypeId("");
      setQuantity("1");
      await loadRules();
      onFeedback({
        kind: "success",
        title: body.updated ? "Packaging rule updated" : "Packaging rule created",
        message: "Dispatch Planning will remove this packaging automatically.",
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging rule could not be saved",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(rule: PackagingRule) {
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/packaging/rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(errorMessage(body, "Packaging rule could not be deleted"));
      }
      await loadRules();
      onFeedback({
        kind: "success",
        title: "Packaging rule deleted",
        message: `${rule.packaging_name} is no longer added automatically.`,
      });
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Packaging rule could not be deleted",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-card prototype-table-card packaging-rules-card">
      <div className="prototype-table-toolbar packaging-toolbar">
        <div>
          <h2>Automatic Packaging Rules</h2>
          <p>Packaging removed together with a box or a device when a dispatch is confirmed.</p>
        </div>
      </div>

      <div className="packaging-rules-form">
        <label>
          <span>When</span>
          <select
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            aria-label="Rule trigger"
          >
            <option value="">Select a packaging or a device</option>
            <optgroup label="Each package of">
              {containers.map((row) => (
                <option key={row.id} value={`packaging:${row.id}`}>{row.name}</option>
              ))}
            </optgroup>
            <optgroup label="Each device of">
              {devices.map((device) => (
                <option key={device.id} value={`device:${device.id}`}>{device.name}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          <span>Also remove</span>
          <select
            value={packagingTypeId}
            onChange={(event) => setPackagingTypeId(event.target.value)}
            aria-label="Packaging to remove"
          >
            <option value="">Select packaging</option>
            {targets.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Quantity</span>
          <input
            type="number"
            min="1"
            max="1000"
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-label="Rule quantity"
          />
        </label>
        <button
          type="button"
          className="prototype-button primary"
          onClick={() => void saveRule()}
          disabled={busy || !trigger || !packagingTypeId || Number(quantity) < 1}
        >
          Save Rule
        </button>
      </div>

      <div className="prototype-table-scroll">
        <table className="prototype-table packaging-table">
          <thead>
            <tr><th>When</th><th>Also remove</th><th>Quantity</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <strong>{rule.trigger_name}</strong>
                  <small>{rule.trigger_kind === "packaging" ? "Each package" : "Each device"}</small>
                </td>
                <td>{rule.packaging_name}</td>
                <td className="packaging-number">
                  {`${rule.quantity} per ${rule.trigger_kind === "packaging" ? "package" : "device"}`}
                </td>
                <td>
                  <div className="packaging-row-actions">
                    <button type="button" onClick={() => void deleteRule(rule)} disabled={busy}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rules.length === 0 && (
              <tr><td colSpan={4} className="packaging-empty">No automatic packaging rules yet.</td></tr>
            )}
            {loading && (
              <tr><td colSpan={4} className="packaging-empty">Loading packaging rules…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
