"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProcessFeedback, {
  type ProcessFeedbackValue,
} from "@/components/ProcessFeedback";

type PackageUsage = {
  packagingTypeId: string;
  code: string;
  name: string;
  quantity: number;
  onHandStock: number;
  availableStock: number;
  stockAfter: number;
};

type DispatchItem = {
  name: string;
  sourceItem: string;
  quantity: number;
  unitVolumeCm3: number;
  totalVolumeCm3: number;
};

type DispatchOrder = {
  orderId: string;
  destinationCountry: string;
  companyName: string;
  lineCount: number;
  totalVolumeCm3: number;
  adjustedVolumeCm3: number;
  items: DispatchItem[];
  packages: Array<{ name: string; code: string; quantity: number }>;
};

type Preview = {
  ok: boolean;
  preview_token?: string;
  source?: {
    filename: string;
    generated_at: string | null;
    parsed_sheets: string[];
  };
  plan?: {
    orders: DispatchOrder[];
    packageUsage: PackageUsage[];
    blockers: string[];
    totalPackages: number;
  };
  issues?: Array<{
    sheet: string;
    row: number;
    message: string;
    hardwareType?: string;
    deviceType?: string;
  }>;
};

type HistoryRow = {
  id: string;
  source_filename: string;
  source_generated_at: string | null;
  status: "CONFIRMED" | "UNDONE";
  order_count: number;
  line_count: number;
  total_packages: number;
  package_usage: PackageUsage[];
  actor_email: string;
  confirmed_at: string;
  undone_at: string | null;
  undone_by_email: string | null;
};

type HistoryDetail = HistoryRow & { orders: DispatchOrder[] };

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function DispatchPlanningPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [feedback, setFeedback] = useState<ProcessFeedbackValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undoTarget, setUndoTarget] = useState<HistoryRow | null>(null);
  const operationId = useRef<string | null>(null);

  const previewTotals = useMemo(() => {
    const orders = preview?.plan?.orders || [];
    return {
      orders: orders.length,
      lines: orders.reduce((total, order) => total + order.lineCount, 0),
      volume: orders.reduce((total, order) => total + order.totalVolumeCm3, 0),
    };
  }, [preview]);

  async function loadHistory() {
    setHistoryBusy(true);
    try {
      const response = await apiFetch(
        `/api/dispatch-planning/history?t=${Date.now()}`,
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => null);
      setHistory(response.ok && json?.ok ? json.rows || [] : []);
    } finally {
      setHistoryBusy(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function previewWorkbook() {
    if (!file) {
      setFeedback({
        kind: "error",
        title: "Workbook required",
        message: "Select the daily Kinesis vehicle order workbook first.",
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    setPreview(null);
    operationId.current = null;
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await apiFetch("/api/dispatch-planning/preview", {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => null);
      if (json?.plan || json?.issues) setPreview(json);
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch preview blocked",
          message: json?.error || "The workbook could not be previewed.",
        });
        return;
      }

      operationId.current = crypto.randomUUID();
      setFeedback({
        kind: "info",
        title: "Preview ready — stock unchanged",
        message: `${json.plan.orders.length} orders were grouped by Order ID. Review the packaging deduction before confirming.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDispatch() {
    setConfirmOpen(false);
    if (!preview?.ok || !preview.preview_token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id:
            operationId.current ||
            (operationId.current = crypto.randomUUID()),
          preview_token: preview.preview_token,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch confirmation failed",
          message: json?.error || "Packaging stock was not changed.",
        });
        return;
      }

      setFeedback({
        kind: "success",
        title: "Daily dispatch confirmed",
        message: `${json.order_count} orders confirmed and ${json.total_packages} packages deducted.`,
      });
      setPreview(null);
      setFile(null);
      setFileInputKey((value) => value + 1);
      operationId.current = null;
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  async function undoDispatch() {
    const batch = undoTarget;
    setUndoTarget(null);
    if (!batch) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: crypto.randomUUID(),
          batch_id: batch.id,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch undo failed",
          message: json?.error || "Packaging stock was not restored.",
        });
        return;
      }
      setDetail(null);
      setFeedback({
        kind: "success",
        title: "Dispatch batch undone",
        message: `${json.restored_packages} packages were restored to stock. The original history remains visible.`,
      });
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    const response = await apiFetch(
      `/api/dispatch-planning/history?id=${encodeURIComponent(id)}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) setDetail(json.row);
    else {
      setFeedback({
        kind: "error",
        title: "History detail unavailable",
        message: json?.error || "The dispatch batch could not be loaded.",
      });
    }
  }

  return (
    <div className="prototype-page dispatch-planning-page">
      <header className="prototype-page-header">
        <div>
          <h1>Dispatch Planning</h1>
          <p>
            Group daily vehicle orders, calculate volume and deduct the selected packaging only after confirmation.
          </p>
        </div>
      </header>

      {feedback ? (
        <ProcessFeedback {...feedback} onDismiss={() => setFeedback(null)} />
      ) : null}

      <div className="prototype-stepper" aria-label="Dispatch progress">
        <div className={`prototype-step ${preview ? "is-complete" : "is-active"}`}>
          <span>{preview ? "✓" : "1"}</span><strong>Upload</strong>
        </div>
        <i />
        <div className={`prototype-step ${preview?.ok ? "is-active" : ""}`}>
          <span>2</span><strong>Preview</strong>
        </div>
        <i />
        <div className="prototype-step">
          <span>3</span><strong>Confirm</strong>
        </div>
      </div>

      <section className="prototype-process-grid dispatch-process-grid">
        <div className="prototype-process-input-column prototype-input-card">
          <span className="prototype-eyebrow">Daily order workbook</span>
          <h2>Import today&apos;s orders</h2>
          <p className="dispatch-help-copy">
            All worksheets are inspected. Rows are grouped by Order ID and matched to the trusted device-volume catalog.
          </p>
          <label className="spreadsheet-file-input">
            Kinesis vehicle sheet (.xlsx)
            <input
              key={fileInputKey}
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setPreview(null);
                operationId.current = null;
              }}
            />
          </label>
          <div className="dispatch-safety-note">
            <strong>Preview is read-only.</strong>
            <span>Packaging stock changes only when you confirm.</span>
          </div>
          <button
            type="button"
            className="prototype-button primary dispatch-full-button"
            onClick={previewWorkbook}
            disabled={busy || !file}
          >
            {busy ? "Working…" : "Preview Packaging"}
          </button>
        </div>

        <div className="prototype-card dispatch-preview-card">
          {!preview?.plan ? (
            <div className="dispatch-empty-preview">
              <span aria-hidden="true">□</span>
              <strong>No preview yet</strong>
              <p>Select the daily workbook to see orders, volumes and packaging before any deduction.</p>
            </div>
          ) : (
            <>
              <div className="dispatch-preview-heading">
                <div>
                  <span className="prototype-eyebrow">Read-only preview</span>
                  <h2>{preview.source?.filename}</h2>
                  <p>{preview.source?.generated_at || "Workbook generated date not provided"}</p>
                </div>
                <div className="dispatch-preview-kpis">
                  <div><span>Orders</span><strong>{previewTotals.orders}</strong></div>
                  <div><span>Lines</span><strong>{previewTotals.lines}</strong></div>
                  <div><span>Packages</span><strong>{preview.plan.totalPackages}</strong></div>
                </div>
              </div>

              {preview.plan.blockers.length > 0 ? (
                <div className="dispatch-blockers" role="alert">
                  {preview.plan.blockers.map((blocker) => <div key={blocker}>{blocker}</div>)}
                </div>
              ) : null}

              <div className="dispatch-package-summary">
                <h3>Packaging deduction</h3>
                {preview.plan.packageUsage.map((usage) => (
                  <div key={usage.packagingTypeId}>
                    <span><strong>{usage.quantity} × {usage.name}</strong><small>{usage.code}</small></span>
                    <span className={usage.stockAfter < 0 ? "is-danger" : ""}>
                      {usage.onHandStock} → {usage.stockAfter}
                    </span>
                  </div>
                ))}
              </div>

              <div className="dispatch-orders-scroll">
                <table>
                  <thead><tr><th>Order ID</th><th>Country</th><th>Customer</th><th>Items</th><th>Volume</th><th>Recommended packaging</th></tr></thead>
                  <tbody>
                    {preview.plan.orders.map((order) => (
                      <tr key={order.orderId}>
                        <td><strong>{order.orderId}</strong></td>
                        <td>{order.destinationCountry || "—"}</td>
                        <td>{order.companyName || "—"}</td>
                        <td>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}</td>
                        <td>{formatNumber(order.totalVolumeCm3, 1)} cm³</td>
                        <td>{order.packages.map((item) => `${item.quantity} × ${item.name}`).join(", ") || "Blocked"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="prototype-preview-actions">
                <button
                  type="button"
                  className="prototype-button secondary"
                  onClick={() => { setPreview(null); operationId.current = null; }}
                  disabled={busy}
                >
                  Clear Preview
                </button>
                <button
                  type="button"
                  className="prototype-button confirm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy || !preview.ok}
                >
                  Confirm &amp; Deduct Packaging
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {preview?.issues?.length ? (
        <section className="prototype-card prototype-history-card">
          <h2>Rows requiring correction</h2>
          <div className="dispatch-orders-scroll is-issues">
            <table><thead><tr><th>Sheet</th><th>Row</th><th>Hardware Type</th><th>Device Type</th><th>Problem</th></tr></thead>
              <tbody>{preview.issues.map((issue, index) => (
                <tr key={`${issue.sheet}-${issue.row}-${index}`}><td>{issue.sheet}</td><td>{issue.row}</td><td>{issue.hardwareType || "—"}</td><td>{issue.deviceType || "—"}</td><td>{issue.message}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="prototype-card prototype-history-card dispatch-history-card">
        <div className="dispatch-history-heading">
          <div><h2>Dispatch History</h2><p>Confirmed and undone packaging deductions remain auditable.</p></div>
          <button type="button" className="prototype-button secondary" onClick={loadHistory} disabled={historyBusy}>Refresh</button>
        </div>
        <div className="dispatch-history-scroll">
          <table>
            <thead><tr><th>Date</th><th>Workbook</th><th>Orders</th><th>Lines</th><th>Packages</th><th>User</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {history.length === 0 ? <tr><td colSpan={8} className="returns-history-empty">{historyBusy ? "Loading history…" : "No dispatch batches yet."}</td></tr> : history.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.confirmed_at)}</td><td><strong>{row.source_filename}</strong></td><td>{row.order_count}</td><td>{row.line_count}</td><td>{row.total_packages}</td><td>{row.actor_email}</td>
                  <td><span className={`dispatch-status is-${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td><div className="dispatch-row-actions">
                    <button type="button" onClick={() => openDetail(row.id)}>View</button>
                    <button type="button" onClick={() => downloadApiFile(`/api/dispatch-planning/export?id=${row.id}`, "dispatch.xlsx")}>Download</button>
                    {row.status === "CONFIRMED" ? <button type="button" className="is-danger" onClick={() => setUndoTarget(row)}>Undo</button> : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {detail ? (
        <div className="returns-history-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
          <div className="returns-history-dialog" role="dialog" aria-modal="true" aria-label={`Dispatch ${detail.source_filename}`}>
            <div className="returns-history-dialog-header"><div><span>Dispatch batch</span><h2>{detail.source_filename}</h2><p>{formatDate(detail.confirmed_at)} · {detail.actor_email}</p></div><button type="button" onClick={() => setDetail(null)} aria-label="Close">×</button></div>
            <div className="returns-history-dialog-summary"><div><span>Status</span><strong>{detail.status}</strong></div><div><span>Orders</span><strong>{detail.order_count}</strong></div><div><span>Lines</span><strong>{detail.line_count}</strong></div><div><span>Packages</span><strong>{detail.total_packages}</strong></div></div>
            <div className="returns-history-dialog-toolbar"><div><strong>Order and packaging detail</strong><span>Every item is linked to its recommended package.</span></div><button type="button" className="prototype-button secondary" onClick={() => downloadApiFile(`/api/dispatch-planning/export?id=${detail.id}`, "dispatch.xlsx")}>Download Excel</button></div>
            <div className="returns-history-dialog-table-scroll"><table><thead><tr><th>Order ID</th><th>Country</th><th>Customer</th><th>Items</th><th>Volume</th><th>Packaging</th></tr></thead><tbody>{(detail.orders || []).map((order) => <tr key={order.orderId}><td><strong>{order.orderId}</strong></td><td>{order.destinationCountry || "—"}</td><td>{order.companyName || "—"}</td><td>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}</td><td>{formatNumber(order.totalVolumeCm3, 1)} cm³</td><td>{order.packages.map((item) => `${item.quantity} × ${item.name}`).join(", ")}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={confirmOpen} title="Confirm daily dispatch?" message={`This will deduct ${preview?.plan?.totalPackages || 0} packages for ${preview?.plan?.orders.length || 0} orders. The action stays available in history and can be undone.`} confirmText="Confirm & Deduct" onConfirm={confirmDispatch} onCancel={() => setConfirmOpen(false)} />
      <ConfirmDialog open={Boolean(undoTarget)} title="Undo this dispatch batch?" message={undoTarget ? `This restores ${undoTarget.total_packages} packages to stock. The batch stays in history as UNDONE.` : undefined} confirmText="Undo & Restore Stock" danger onConfirm={undoDispatch} onCancel={() => setUndoTarget(null)} />
    </div>
  );
}
