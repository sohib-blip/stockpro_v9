import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { isDispatchPlanLocking } from "@/lib/dispatch-assignments";
import {
  dispatchToday,
  listDispatchAssignableUsers,
  loadDispatchPlanAssignments,
  loadTodayDispatchPlan,
} from "@/app/api/dispatch-planning/plan/_plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Today's plan for every account: who is planning, the full assignment and
// the people orders can be given to.
export async function GET(req: Request) {
  try {
    const identity = getApiIdentity(req);
    const service = supabaseService();
    const today = dispatchToday();
    const { installed, plan } = await loadTodayDispatchPlan(service, today);
    if (!installed) {
      return NextResponse.json({ ok: true, installed: false, today, plan: null });
    }
    if (!plan) {
      return NextResponse.json({
        ok: true,
        installed: true,
        today,
        me: { id: identity.userId, email: identity.email, admin: identity.role === "admin" },
        plan: null,
        assignments: [],
        users: [],
      });
    }

    const [assignments, users] = await Promise.all([
      loadDispatchPlanAssignments(service, plan.id),
      listDispatchAssignableUsers(service),
    ]);
    const labelCounts = new Map<string, number>();
    for (const label of plan.labels || []) {
      labelCounts.set(label.orderId, (labelCounts.get(label.orderId) || 0) + 1);
    }

    return NextResponse.json({
      ok: true,
      installed: true,
      today,
      me: { id: identity.userId, email: identity.email, admin: identity.role === "admin" },
      plan: {
        id: plan.id,
        plan_date: plan.plan_date,
        status: plan.status,
        planner_id: plan.planner_id,
        planner_email: plan.planner_email,
        source_filename: plan.source_filename,
        started_at: plan.started_at,
        closed_at: plan.closed_at,
        closed_by_email: plan.closed_by_email,
        locking: isDispatchPlanLocking(plan, today),
        orders: (plan.orders || []).map((order) => ({
          ...order,
          labelCount: labelCounts.get(order.orderId) || 0,
        })),
      },
      assignments,
      users,
    });
  } catch (error) {
    console.error("DISPATCH PLAN ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Today's dispatch planning could not be loaded." },
      { status: 500 }
    );
  }
}
