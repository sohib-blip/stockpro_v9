"use client";

import { useMemo, useState } from "react";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { ProcessFeedbackValue } from "@/components/ProcessFeedback";
import {
  dispatchAssigneeTotals,
  dispatchOrdersForModel,
  dispatchPlanDeviceModels,
  vehicleLabelsFilename,
  type DispatchPlanAssignment,
  type DispatchPlanOrder,
  type DispatchPlanStatus,
} from "@/lib/dispatch-assignments";

export type DispatchPlanState = {
  ok: boolean;
  installed: boolean;
  today: string;
  me?: { id: string; email: string; admin: boolean };
  plan: {
    id: string;
    plan_date: string;
    status: DispatchPlanStatus;
    planner_id: string | null;
    planner_email: string;
    source_filename: string;
    started_at: string;
    closed_at: string | null;
    closed_by_email: string | null;
    locking: boolean;
    orders: Array<DispatchPlanOrder & { labelCount: number }>;
  } | null;
  assignments?: DispatchPlanAssignment[];
  users?: Array<{ id: string; email: string }>;
};

// Same file name as the former full download from the preview.
const ALL_LABELS_FILENAME = "vehicle-registration-labels-L4731.docx";

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    timeStyle: "short",
  }).format(new Date(value));
}

function deviceSummary(order: DispatchPlanOrder) {
  const parts = Object.entries(order.deviceCounts).map(
    ([model, count]) => `${count} × ${model}`
  );
  return parts.length ? parts.join(", ") : "No devices";
}

/** Ends today's planning without a deduction, or lets an admin take it over. */
export async function changeDispatchPlanLock(
  planId: string,
  action: "release" | "takeover"
): Promise<{ ok: true } | { ok: false; error?: string }> {
  const response = await apiFetch("/api/dispatch-planning/plan/lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId, action }),
  });
  const json = await response.json().catch(() => null);
  return response.ok && json?.ok ? { ok: true } : { ok: false, error: json?.error };
}

/** Who is doing today's dispatch planning; shown above the workbook import. */
export function DispatchPlanBanner({
  state,
  onReload,
  onFeedback,
}: {
  state: DispatchPlanState | null;
  onReload: () => Promise<void> | void;
  onFeedback: (value: ProcessFeedbackValue | null) => void;
}) {
  const [action, setAction] = useState<"release" | "takeover" | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = state?.plan;
  if (!plan?.locking || !state?.me) return null;
  const mine = plan.planner_id === state.me.id;

  async function run(kind: "release" | "takeover") {
    setAction(null);
    setBusy(true);
    try {
      const result = await changeDispatchPlanLock(plan!.id, kind);
      onFeedback(
        result.ok
          ? {
              kind: "success",
              title: kind === "takeover" ? "You are now doing today's dispatch planning" : "Dispatch planning ended",
              message:
                kind === "takeover"
                  ? "The assignments were kept. Import the same workbook to continue."
                  : "Nothing was deducted. Other accounts can import a workbook again.",
            }
          : {
              kind: "error",
              title: "Dispatch planning not changed",
              message: (!result.ok && result.error) || "The dispatch planning could not be updated.",
            }
      );
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={`dispatch-plan-banner ${mine ? "is-mine" : "is-locked"}`} role="status">
        <div>
          <strong>
            {mine
              ? `You are doing today's dispatch planning (since ${formatTime(plan.started_at)})`
              : `${plan.planner_email} is doing today's dispatch planning (since ${formatTime(plan.started_at)})`}
          </strong>
          <span>
            {mine
              ? "Other accounts cannot import or confirm a workbook until you confirm the deduction."
              : "Import and confirmation are blocked on your account to avoid double work. You can still see the assignments below."}
          </span>
        </div>
        {mine ? (
          <button type="button" className="prototype-button secondary" disabled={busy} onClick={() => setAction("release")}>
            End without deduction
          </button>
        ) : state.me.admin ? (
          <button type="button" className="prototype-button secondary" disabled={busy} onClick={() => setAction("takeover")}>
            Take over
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={action !== null}
        title={action === "takeover" ? "Take over today's dispatch planning?" : "End today's dispatch planning without deduction?"}
        message={
          action === "takeover"
            ? `${plan.planner_email} will no longer be able to assign orders or confirm the deduction. The assignments are kept.`
            : "No packaging is deducted. Other accounts can then import a workbook. Normally the planning ends when you confirm the deduction."
        }
        confirmText={action === "takeover" ? "Take over" : "End planning"}
        onConfirm={() => action && void run(action)}
        onCancel={() => setAction(null)}
      />
    </>
  );
}

/** Today's orders, who does which one, and each person's vehicle labels. */
export default function DispatchAssignments({
  state,
  onReload,
  onFeedback,
}: {
  state: DispatchPlanState | null;
  onReload: () => Promise<void> | void;
  onFeedback: (value: ProcessFeedbackValue | null) => void;
}) {
  const [model, setModel] = useState("");
  const [modelAssignee, setModelAssignee] = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [labelsBusy, setLabelsBusy] = useState<string | null>(null);

  const plan = state?.plan ?? null;
  const assignments = useMemo(() => state?.assignments ?? [], [state]);
  const users = state?.users ?? [];
  const me = state?.me;
  const canAssign = Boolean(plan?.locking && me && plan.planner_id === me.id);
  const byOrder = useMemo(
    () => new Map(assignments.map((assignment) => [assignment.orderId, assignment])),
    [assignments]
  );
  const models = useMemo(() => dispatchPlanDeviceModels(plan?.orders ?? []), [plan]);
  const totals = useMemo(
    () => dispatchAssigneeTotals(plan?.orders ?? [], assignments),
    [plan, assignments]
  );
  const myOrders = useMemo(
    () => (plan?.orders ?? []).filter((order) => byOrder.get(order.orderId)?.assigneeId === me?.id),
    [byOrder, me, plan]
  );
  const myLabelCount = myOrders.reduce((total, order) => total + order.labelCount, 0);
  const filteredOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const orders = plan?.orders ?? [];
    if (!query) return orders;
    return orders.filter((order) =>
      [
        order.orderId,
        order.companyName,
        order.destinationCountry,
        byOrder.get(order.orderId)?.assigneeEmail || "unassigned",
        ...Object.keys(order.deviceCounts),
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query))
    );
  }, [byOrder, plan, search]);

  // A planning ended without deduction is abandoned: nothing left to assign.
  if (!state?.installed || !plan || plan.status === "RELEASED" || plan.status === "REPLACED") {
    return null;
  }
  const allLabelCount = plan.orders.reduce((total, order) => total + order.labelCount, 0);
  const allDeviceCount = plan.orders.reduce((total, order) => total + order.deviceCount, 0);

  const modelOrderIds = model
    ? dispatchOrdersForModel(plan.orders, model, assignments, onlyUnassigned)
    : [];

  async function assign(orderIds: string[], assigneeId: string | null) {
    if (!plan || orderIds.length === 0) return;
    setBusy(true);
    try {
      const response = await apiFetch("/api/dispatch-planning/plan/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id, order_ids: orderIds, assignee_id: assigneeId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        onFeedback({
          kind: "error",
          title: "Assignment not saved",
          message: json?.error || "The orders could not be assigned.",
        });
      }
      await onReload();
    } finally {
      setBusy(false);
    }
  }

  // One person's orders, or every order of the planning ("all").
  async function downloadLabels(assigneeId: string | "all", email = "") {
    if (!plan) return;
    setLabelsBusy(assigneeId);
    try {
      await downloadApiFile(
        assigneeId === "all"
          ? `/api/dispatch-planning/plan/labels?plan_id=${plan.id}&scope=all`
          : `/api/dispatch-planning/plan/labels?plan_id=${plan.id}&assignee_id=${assigneeId}`,
        assigneeId === "all" ? ALL_LABELS_FILENAME : vehicleLabelsFilename(email)
      );
    } catch (error) {
      onFeedback({
        kind: "error",
        title: "Vehicle label generation failed",
        message: error instanceof Error ? error.message : "The vehicle label Word document could not be generated.",
      });
    } finally {
      setLabelsBusy(null);
    }
  }

  const statusText =
    plan.status === "OPEN"
      ? plan.locking
        ? `Planning by ${plan.planner_email}`
        : "Planning not confirmed (previous day)"
      : plan.status === "CONFIRMED"
        ? `Deduction confirmed by ${plan.closed_by_email || plan.planner_email} at ${formatTime(plan.closed_at)}`
        : `Planning ended by ${plan.closed_by_email || plan.planner_email} at ${formatTime(plan.closed_at)}`;

  return (
    <section className="prototype-card dispatch-assign-card">
      <div className="dispatch-card-heading">
        <div>
          <h2>Order assignment</h2>
          <p>
            {plan.source_filename} · {statusText}
          </p>
        </div>
        <button type="button" className="prototype-button secondary dispatch-small-button" onClick={() => void onReload()} disabled={busy}>
          Refresh
        </button>
      </div>

      <div className="dispatch-assign-mine">
        <div>
          <span className="prototype-eyebrow">My orders today</span>
          <strong>
            {myOrders.length} order{myOrders.length === 1 ? "" : "s"} · {myOrders.reduce((total, order) => total + order.deviceCount, 0)} devices
          </strong>
          <span>{myOrders.length ? myOrders.map((order) => order.orderId).join(", ") : "No order is assigned to you yet."}</span>
        </div>
        <button
          type="button"
          className="prototype-button primary"
          disabled={!me || myLabelCount === 0 || labelsBusy !== null}
          onClick={() => me && void downloadLabels(me.id, me.email)}
        >
          {labelsBusy === me?.id ? "Generating Word…" : `Download my vehicle labels — Word (${myLabelCount})`}
        </button>
      </div>

      {canAssign ? (
        <div className="dispatch-assign-bar">
          <label>
            Device model
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">Select a model</option>
              {models.map((entry) => (
                <option key={entry.model} value={entry.model}>
                  {entry.model} ({entry.devices} devices)
                </option>
              ))}
            </select>
          </label>
          <label>
            Person
            <select value={modelAssignee} onChange={(event) => setModelAssignee(event.target.value)}>
              <option value="">Select a person</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.email}</option>
              ))}
            </select>
          </label>
          <label className="dispatch-assign-check">
            <input type="checkbox" checked={onlyUnassigned} onChange={(event) => setOnlyUnassigned(event.target.checked)} />
            Only unassigned orders
          </label>
          <button
            type="button"
            className="prototype-button confirm"
            disabled={busy || !model || !modelAssignee || modelOrderIds.length === 0}
            onClick={() => void assign(modelOrderIds, modelAssignee)}
          >
            {model ? `Assign ${modelOrderIds.length} whole order${modelOrderIds.length === 1 ? "" : "s"}` : "Assign"}
          </button>
        </div>
      ) : null}

      <div className="dispatch-assign-totals">
        <div className="is-all">
          <strong>All orders</strong>
          <span>
            {plan.orders.length} order{plan.orders.length === 1 ? "" : "s"} · {allDeviceCount} devices
          </span>
          <button
            type="button"
            aria-label={`Download vehicle labels for all orders — Word (${allLabelCount})`}
            disabled={labelsBusy !== null || allLabelCount === 0}
            onClick={() => void downloadLabels("all")}
          >
            {labelsBusy === "all" ? "Generating…" : `Word labels (${allLabelCount})`}
          </button>
        </div>
        {totals.map((total) => (
          <div key={total.assigneeId ?? "unassigned"} className={total.assigneeId ? "" : "is-unassigned"}>
            <strong>{total.assigneeEmail ?? "Unassigned"}</strong>
            <span>
              {total.orders} order{total.orders === 1 ? "" : "s"} · {total.devices} devices
            </span>
            {total.assigneeId && total.assigneeId !== me?.id ? (
              <button
                type="button"
                disabled={labelsBusy !== null}
                onClick={() => void downloadLabels(total.assigneeId!, total.assigneeEmail || "")}
              >
                {labelsBusy === total.assigneeId ? "Generating…" : "Word labels"}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="dispatch-orders-heading">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search order, customer, model or person"
          aria-label="Search assigned orders"
        />
      </div>
      <div className="dispatch-history-scroll">
        <table>
          <thead>
            <tr><th>Order ID</th><th>Customer</th><th>Country</th><th>Devices</th><th>Labels</th><th>Assigned to</th></tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr><td colSpan={6} className="returns-history-empty">No orders match this search.</td></tr>
            ) : filteredOrders.map((order) => {
              const assignment = byOrder.get(order.orderId);
              return (
                <tr key={order.orderId} className={assignment ? "" : "is-unassigned"}>
                  <td><strong>{order.orderId}</strong></td>
                  <td>{order.companyName || "—"}</td>
                  <td>{order.destinationCountry || "—"}</td>
                  <td>{deviceSummary(order)}</td>
                  <td>{order.labelCount}</td>
                  <td>
                    {canAssign ? (
                      <select
                        value={assignment?.assigneeId || ""}
                        disabled={busy}
                        aria-label={`Person for order ${order.orderId}`}
                        onChange={(event) => void assign([order.orderId], event.target.value || null)}
                      >
                        <option value="">Unassigned</option>
                        {users.map((user) => (
                          <option key={user.id} value={user.id}>{user.email}</option>
                        ))}
                      </select>
                    ) : (
                      assignment?.assigneeEmail || <span className="dispatch-assign-none">Unassigned</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
