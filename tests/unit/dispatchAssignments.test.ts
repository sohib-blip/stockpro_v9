import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForApi } from "../../lib/access-control";
import {
  dispatchAssigneeTotals,
  dispatchLabelsForAssignee,
  dispatchOrdersForModel,
  dispatchPlanDeviceModels,
  dispatchPlanOrders,
  isDispatchPlanLocking,
  vehicleLabelsFilename,
  type DispatchPlanAssignment,
} from "../../lib/dispatch-assignments";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20261104090000_add_dispatch_plan_assignments.sql");

// O1: 3 FMC880. O2: 2 FMC880 + 1 CV200. O3: 4 CV200. O4: accessories only.
const orders = dispatchPlanOrders([
  { orderId: "O1", companyName: "Fleet A", destinationCountry: "BE", deviceCounts: { "BarraGPS FMC880": 3 } },
  { orderId: "O2", companyName: "Fleet B", destinationCountry: "NL", deviceCounts: { "BarraGPS FMC880": 2, CV200: 1 } },
  { orderId: "O3", companyName: "Fleet C", destinationCountry: "FR", deviceCounts: { CV200: 4 } },
  { orderId: "O4", companyName: "Fleet D", destinationCountry: "BE", deviceCounts: {} },
]);

const labels = [
  { registration: "1-ABC-001", deviceModel: "BarraGPS FMC880", orderId: "O1" },
  { registration: "1-ABC-002", deviceModel: "BarraGPS FMC880", orderId: "O1" },
  { registration: "1-ABC-003", deviceModel: "BarraGPS FMC880", orderId: "O1" },
  { registration: "2-XYZ-001", deviceModel: "BarraGPS FMC880", orderId: "O2" },
  { registration: "2-XYZ-002", deviceModel: "BarraGPS FMC880", orderId: "O2" },
  { registration: "2-XYZ-003", deviceModel: "CV200", orderId: "O2" },
  { registration: "3-CV-001", deviceModel: "CV200", orderId: "O3" },
];

const karim = { assigneeId: "user-karim", assigneeEmail: "karim@stockpro.test" };
const sara = { assigneeId: "user-sara", assigneeEmail: "sara@stockpro.test" };

describe("dispatch order assignment", () => {
  it("keeps device counts per order for the plan", () => {
    expect(orders.map((order) => order.deviceCount)).toEqual([3, 3, 4, 0]);
    expect(dispatchPlanDeviceModels(orders)).toEqual([
      { model: "BarraGPS FMC880", devices: 5 },
      { model: "CV200", devices: 5 },
    ]);
  });

  it("selects every order containing a model, whole, even with other models", () => {
    expect(dispatchOrdersForModel(orders, "BarraGPS FMC880")).toEqual(["O1", "O2"]);
    expect(dispatchOrdersForModel(orders, "CV200")).toEqual(["O2", "O3"]);
    expect(dispatchOrdersForModel(orders, "Unknown")).toEqual([]);
  });

  it("can leave orders already given to someone with that person", () => {
    const assignments: DispatchPlanAssignment[] = [{ orderId: "O2", ...karim }];
    expect(dispatchOrdersForModel(orders, "CV200", assignments, true)).toEqual(["O3"]);
    expect(dispatchOrdersForModel(orders, "CV200", assignments, false)).toEqual(["O2", "O3"]);
  });

  it("gives each person only the vehicle labels of their orders, all models included", () => {
    const assignments: DispatchPlanAssignment[] = [
      { orderId: "O1", ...karim },
      { orderId: "O2", ...karim },
      { orderId: "O3", ...sara },
    ];
    expect(dispatchLabelsForAssignee(labels, assignments, "user-karim").map((label) => label.registration)).toEqual([
      "1-ABC-001",
      "1-ABC-002",
      "1-ABC-003",
      "2-XYZ-001",
      "2-XYZ-002",
      "2-XYZ-003",
    ]);
    expect(dispatchLabelsForAssignee(labels, assignments, "user-sara").map((label) => label.registration)).toEqual(["3-CV-001"]);
    expect(dispatchLabelsForAssignee(labels, assignments, "user-nobody")).toEqual([]);
  });

  it("totals orders and devices per person, unassigned last", () => {
    const totals = dispatchAssigneeTotals(orders, [
      { orderId: "O3", ...sara },
      { orderId: "O1", ...karim },
    ]);
    expect(totals).toEqual([
      { assigneeId: "user-karim", assigneeEmail: "karim@stockpro.test", orders: 1, devices: 3 },
      { assigneeId: "user-sara", assigneeEmail: "sara@stockpro.test", orders: 1, devices: 4 },
      { assigneeId: null, assigneeEmail: null, orders: 2, devices: 3 },
    ]);
  });

  it("only locks other accounts on the plan's own day while it is open", () => {
    expect(isDispatchPlanLocking({ status: "OPEN", plan_date: "2026-11-04" }, "2026-11-04")).toBe(true);
    expect(isDispatchPlanLocking({ status: "OPEN", plan_date: "2026-11-03" }, "2026-11-04")).toBe(false);
    expect(isDispatchPlanLocking({ status: "CONFIRMED", plan_date: "2026-11-04" }, "2026-11-04")).toBe(false);
    expect(isDispatchPlanLocking({ status: "RELEASED", plan_date: "2026-11-04" }, "2026-11-04")).toBe(false);
    expect(isDispatchPlanLocking(null, "2026-11-04")).toBe(false);
  });

  it("names the Word file after the person", () => {
    expect(vehicleLabelsFilename("karim.b@stockpro.test")).toBe(
      "vehicle-registration-labels-L4731-karim.b.docx"
    );
  });
});

describe("dispatch planner lock", () => {
  it("allows one open plan per day in the database", () => {
    expect(migration).toMatch(
      /create unique index if not exists dispatch_plans_one_open_per_day[\s\S]*?where status = 'OPEN'/
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'LOCKED'");
    expect(migration).toContain("'REPLACE_REQUIRED'");
    expect(migration).toMatch(/plan_date < p_plan_date/);
  });

  it("keeps the new tables server-only", () => {
    expect(migration).toContain("revoke all on table public.dispatch_plans from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.dispatch_plan_assignments from public, anon, authenticated");
  });

  it("blocks preview and confirmation for other accounts and ends the lock on confirmation", () => {
    const preview = read("app/api/dispatch-planning/preview/route.ts");
    expect(preview).toContain("startDispatchPlan(");
    expect(preview).toContain("DISPATCH_PLAN_LOCKED");
    const confirm = read("app/api/dispatch-planning/confirm/route.ts");
    expect(confirm.indexOf("dispatchPlanHeldByOther(")).toBeLessThan(
      confirm.indexOf('rpc(\n      "confirm_dispatch_batch"')
    );
    expect(confirm).toContain("confirmDispatchPlan(");
  });

  it("serves every order's Word labels from the saved planning", () => {
    const labels = read("app/api/dispatch-planning/plan/labels/route.ts");
    expect(labels).toContain('params.get("scope") === "all"');
    expect(labels).toMatch(/allOrders\s*\?\s*plan\.labels/);
    const page = read("app/(app)/dispatch-planning/page.tsx");
    expect(page).not.toContain("/api/dispatch-planning/vehicle-labels");
    expect(page).toContain('changeDispatchPlanLock(planId, "release")');
  });

  it("only lets today's planner assign orders", () => {
    const assign = read("app/api/dispatch-planning/plan/assign/route.ts");
    expect(assign).toContain("plan.planner_id !== identity.userId");
    expect(assign).toContain("isDispatchPlanLocking(plan, dispatchToday())");
  });

  it("uses the Dispatch Planning permission for the new routes", () => {
    for (const path of [
      "/api/dispatch-planning/plan",
      "/api/dispatch-planning/plan/assign",
      "/api/dispatch-planning/plan/lock",
      "/api/dispatch-planning/plan/labels",
    ]) {
      expect(permissionsForApi(path, "GET")).toEqual(["can_outbound"]);
    }
  });
});
