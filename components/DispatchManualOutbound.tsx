"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";

type PackagingRow = {
  id: string;
  code: string;
  name: string;
  available_stock: number;
};

type Line = { packagingTypeId: string; quantity: string };

type Allocation = { packagingTypeId: string; name: string; quantity: number };

type ManualPlan = {
  orders: Array<{ packages: Allocation[]; extras?: Allocation[] }>;
  packageUsage: Array<{
    packagingTypeId: string;
    name: string;
    code: string;
    quantity: number;
    onHandStock: number;
    stockAfter: number;
  }>;
  blockers: string[];
  totalPackages: number;
};

const EMPTY_LINE: Line = { packagingTypeId: "", quantity: "1" };

function errorMessage(body: unknown, fallback: string) {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.trim() ? error : fallback;
}

// Manual packaging outbound in Dispatch Planning: choose packaging lines,
// preview them with the automatic packaging rules, then deduct. The result is
// listed in Dispatch History and can be undone like a daily dispatch.
export default function DispatchManualOutbound({
  modeSwitch,
  onFeedback,
  onConfirmed,
}: {
  modeSwitch?: ReactNode;
  onFeedback: (feedback: ProcessFeedbackValue | null) => void;
  onConfirmed: () => void;
}) {
  const [options, setOptions] = useState<PackagingRow[]>([]);
  const [reference, setReference] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<Line[]>([EMPTY_LINE]);
  const [plan, setPlan] = useState<ManualPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const operationId = useRef<string | null>(null);

  async function loadOptions() {
    const response = await apiFetch(`/api/packaging/list?t=${Date.now()}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.ok) setOptions(body.rows || []);
  }

  useEffect(() => {
    void loadOptions();
  }, []);

  const validLines = useMemo(
    () =>
      lines
        .filter((line) => line.packagingTypeId && Number(line.quantity) >= 1)
        .map((line) => ({
          packagingTypeId: line.packagingTypeId,
          quantity: Math.floor(Number(line.quantity)),
        })),
    [lines]
  );

  function updateLine(index: number, update: Partial<Line>) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...update } : line)));
    setPlan(null);
  }

  async function submit(preview: boolean) {
    if (validLines.length === 0) return;
    setBusy(true);
    onFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: operationId.current || (operationId.current = crypto.randomUUID()),
          preview,
          reference,
          comment,
          lines: validLines,
        }),
      });
      const body = await response.json().catch(() => null);
      if (preview || body?.plan) {
        if (!body?.plan) throw new Error(errorMessage(body, "Manual packaging outbound could not be previewed."));
        setPlan(body.plan);
        if (!body.ok) {
          onFeedback({
            kind: "error",
            title: "Manual outbound blocked",
            message: errorMessage(body, "Packaging stock needs attention before confirmation."),
          });
        }
        return;
      }
      if (!response.ok || !body?.ok) {
        throw new Error(errorMessage(body, "Manual packaging outbound failed."));
      }
      onFeedback({
        kind: "success",
        title: "Manual outbound confirmed",
        message: `${body.total_packages} packages deducted. You can undo it in Dispatch History.`,
      });
      operationId.current = null;
      setReference("");
      setComment("");
      setLines([EMPTY_LINE]);
      setPlan(null);
      await loadOptions();
      onConfirmed();
    } catch (error) {
      onFeedback({
        kind: "error",
        title: preview ? "Preview failed" : "Manual outbound failed",
        message: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const order = plan?.orders[0];
  const chosenIds = new Set((order?.packages || []).map((item) => item.packagingTypeId));
  const automaticIds = new Set((order?.extras || []).map((item) => item.packagingTypeId));

  return (
    <section className="prototype-process-grid dispatch-process-grid">
      <div className="prototype-process-input-column prototype-input-card">
        {modeSwitch}
        <span className="prototype-eyebrow">Manual packaging outbound</span>
        <h2>Remove packaging by hand</h2>
        <p className="dispatch-help-copy">
          For packaging used outside the daily workbook. Automatic packaging rules still add sleeves and plastic envelopes.
        </p>
        <div className="dispatch-manual-fields">
          <input
            aria-label="Manual outbound reference"
            value={reference}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Reference (optional)"
          />
          <input
            aria-label="Manual outbound comment"
            value={comment}
            maxLength={120}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comment (optional)"
          />
        </div>
        <div className="dispatch-manual-lines">
          {lines.map((line, index) => (
            <div key={index} className="dispatch-manual-line">
              <select
                aria-label={`Manual packaging line ${index + 1}`}
                value={line.packagingTypeId}
                onChange={(event) => updateLine(index, { packagingTypeId: event.target.value })}
              >
                <option value="">Select packaging</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {`${option.name} — ${option.available_stock} available`}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Manual packaging quantity ${index + 1}`}
                type="number"
                min={1}
                max={1_000_000}
                value={line.quantity}
                onChange={(event) => updateLine(index, { quantity: event.target.value })}
              />
              <button
                type="button"
                className="prototype-button secondary"
                disabled={lines.length === 1}
                onClick={() => {
                  setLines((current) => current.filter((_, at) => at !== index));
                  setPlan(null);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="prototype-button secondary"
            onClick={() => setLines((current) => [...current, EMPTY_LINE])}
          >
            + Add line
          </button>
        </div>
        <button
          type="button"
          className="prototype-button primary dispatch-full-button"
          onClick={() => void submit(true)}
          disabled={busy || validLines.length === 0}
        >
          {busy ? "Working…" : "Preview Manual Outbound"}
        </button>
      </div>

      <div className="prototype-card dispatch-preview-card">
        {!plan ? (
          <div className="dispatch-empty-preview">
            <span aria-hidden="true">□</span>
            <strong>No preview yet</strong>
            <p>Choose the packaging to remove, then preview every stock change before confirmation.</p>
          </div>
        ) : (
          <div className="outbound-preview">
            {plan.blockers.length > 0 ? (
              <ul className="outbound-preview-blockers">
                {plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : null}
            <table>
              <thead>
                <tr><th>Packaging</th><th>Quantity</th><th>Source</th><th>Stock</th></tr>
              </thead>
              <tbody>
                {plan.packageUsage.map((usage) => (
                  <tr key={usage.packagingTypeId}>
                    <td><strong>{usage.name}</strong><small>{usage.code}</small></td>
                    <td>{usage.quantity}</td>
                    <td>
                      {chosenIds.has(usage.packagingTypeId) && automaticIds.has(usage.packagingTypeId)
                        ? "Selected + automatic rule"
                        : automaticIds.has(usage.packagingTypeId)
                          ? "Automatic rule"
                          : "Selected"}
                    </td>
                    <td className={usage.stockAfter < 0 ? "is-danger" : ""}>
                      {usage.onHandStock} → {usage.stockAfter}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="outbound-preview-actions">
              <span>{`${plan.totalPackages} packages`}</span>
              <button
                type="button"
                className="prototype-button primary"
                disabled={busy || plan.blockers.length > 0}
                onClick={() => setConfirmOpen(true)}
              >
                Confirm & Deduct
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm manual outbound?"
        message={`This will deduct ${plan?.totalPackages || 0} packages. The action stays available in Dispatch History and can be undone.`}
        confirmText="Confirm & Deduct"
        onConfirm={() => {
          setConfirmOpen(false);
          void submit(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
