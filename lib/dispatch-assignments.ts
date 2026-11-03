// Dispatch Planning order assignment: today's planner gives each order of the
// daily workbook to one person, who then prints the vehicle labels of their
// own orders. An order is always assigned whole, even when it holds several
// device models.

import type { DispatchOrder } from "./dispatch-planning";
import type { DispatchVehicleLabel } from "./dispatch-vehicle-labels";

export type DispatchPlanStatus = "OPEN" | "CONFIRMED" | "RELEASED" | "REPLACED";

export type DispatchPlanOrder = {
  orderId: string;
  companyName: string;
  destinationCountry: string;
  deviceCounts: Record<string, number>;
  deviceCount: number;
};

export type DispatchPlanLabel = Pick<
  DispatchVehicleLabel,
  "registration" | "deviceModel" | "orderId"
>;

export type DispatchPlanAssignment = {
  orderId: string;
  assigneeId: string;
  assigneeEmail: string;
};

export type DispatchAssigneeTotal = {
  assigneeId: string | null;
  assigneeEmail: string | null;
  orders: number;
  devices: number;
};

/** The order data kept with today's plan (no packaging, no volumes). */
export function dispatchPlanOrders(
  orders: Array<Pick<DispatchOrder, "orderId" | "companyName" | "destinationCountry" | "deviceCounts">>
): DispatchPlanOrder[] {
  return orders.map((order) => {
    const deviceCounts = Object.fromEntries(
      Object.entries(order.deviceCounts || {}).filter(([, count]) => Number(count) > 0)
    );
    return {
      orderId: order.orderId,
      companyName: order.companyName || "",
      destinationCountry: order.destinationCountry || "",
      deviceCounts,
      deviceCount: Object.values(deviceCounts).reduce(
        (total, count) => total + Number(count),
        0
      ),
    };
  });
}

export function dispatchPlanLabels(labels: DispatchVehicleLabel[]): DispatchPlanLabel[] {
  return labels.map(({ registration, deviceModel, orderId }) => ({
    registration,
    deviceModel,
    orderId,
  }));
}

/** Device models of the plan, most devices first. */
export function dispatchPlanDeviceModels(orders: DispatchPlanOrder[]) {
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const [model, count] of Object.entries(order.deviceCounts)) {
      totals.set(model, (totals.get(model) || 0) + Number(count));
    }
  }
  return Array.from(totals, ([model, devices]) => ({ model, devices })).sort(
    (left, right) =>
      right.devices - left.devices || left.model.localeCompare(right.model)
  );
}

/**
 * Orders selected by a device model: every order that contains at least one
 * device of that model, whole. With onlyUnassigned, orders already given to
 * someone are left with that person.
 */
export function dispatchOrdersForModel(
  orders: DispatchPlanOrder[],
  model: string,
  assignments: DispatchPlanAssignment[] = [],
  onlyUnassigned = false
) {
  const assigned = new Set(assignments.map((assignment) => assignment.orderId));
  return orders
    .filter((order) => Number(order.deviceCounts[model] || 0) > 0)
    .filter((order) => !onlyUnassigned || !assigned.has(order.orderId))
    .map((order) => order.orderId);
}

/** Vehicle labels of the orders assigned to one person, in workbook order. */
export function dispatchLabelsForAssignee(
  labels: DispatchPlanLabel[],
  assignments: DispatchPlanAssignment[],
  assigneeId: string
) {
  const orderIds = new Set(
    assignments
      .filter((assignment) => assignment.assigneeId === assigneeId)
      .map((assignment) => assignment.orderId)
  );
  return labels.filter((label) => orderIds.has(label.orderId));
}

/** Orders and devices per person; the unassigned total comes last. */
export function dispatchAssigneeTotals(
  orders: DispatchPlanOrder[],
  assignments: DispatchPlanAssignment[]
): DispatchAssigneeTotal[] {
  const byOrder = new Map(assignments.map((assignment) => [assignment.orderId, assignment]));
  const totals = new Map<string | null, DispatchAssigneeTotal>();
  for (const order of orders) {
    const assignment = byOrder.get(order.orderId);
    const key = assignment?.assigneeId ?? null;
    const current = totals.get(key) || {
      assigneeId: key,
      assigneeEmail: assignment?.assigneeEmail ?? null,
      orders: 0,
      devices: 0,
    };
    current.orders += 1;
    current.devices += order.deviceCount;
    totals.set(key, current);
  }
  const people = Array.from(totals.values())
    .filter((total) => total.assigneeId !== null)
    .sort((left, right) =>
      String(left.assigneeEmail).localeCompare(String(right.assigneeEmail))
    );
  const unassigned = totals.get(null);
  return unassigned ? [...people, unassigned] : people;
}

/** A plan only locks the other accounts on its own day while it is open. */
export function isDispatchPlanLocking(
  plan: { status: DispatchPlanStatus; plan_date: string } | null | undefined,
  today: string
) {
  return Boolean(plan && plan.status === "OPEN" && plan.plan_date === today);
}

export function vehicleLabelsFilename(email: string) {
  const name = email.split("@")[0].replace(/[^a-z0-9._-]+/gi, "-").slice(0, 60) || "user";
  return `vehicle-registration-labels-L4731-${name}.docx`;
}
