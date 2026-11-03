import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { isDispatchPlanLocking } from "@/lib/dispatch-assignments";
import { readJsonBodyWithinLimit } from "@/lib/security/request-budget";
import {
  dispatchToday,
  loadDispatchPlanById,
} from "@/app/api/dispatch-planning/plan/_plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  plan_id: z.string().uuid(),
  order_ids: z.array(z.string().trim().min(1).max(500)).min(1).max(5000),
  // null removes the assignment.
  assignee_id: z.string().uuid().nullable(),
});

// Only today's planner assigns, while the plan is open.
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(
      await readJsonBodyWithinLimit(req, 400_000).catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid order assignment." },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const service = supabaseService();
    const plan = await loadDispatchPlanById(service, parsed.data.plan_id);
    if (!plan || !isDispatchPlanLocking(plan, dispatchToday())) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This dispatch planning is closed. Orders can only be assigned before the deduction is confirmed.",
        },
        { status: 409 }
      );
    }
    if (plan.planner_id !== identity.userId) {
      return NextResponse.json(
        {
          ok: false,
          error: `${plan.planner_email} is doing today's dispatch planning. Only that person can assign orders.`,
        },
        { status: 409 }
      );
    }

    const planOrderIds = new Set((plan.orders || []).map((order) => order.orderId));
    const orderIds = Array.from(new Set(parsed.data.order_ids));
    if (orderIds.some((orderId) => !planOrderIds.has(orderId))) {
      return NextResponse.json(
        { ok: false, error: "One or more orders are not part of today's workbook." },
        { status: 400 }
      );
    }

    if (parsed.data.assignee_id === null) {
      const { error } = await service
        .from("dispatch_plan_assignments")
        .delete()
        .eq("plan_id", plan.id)
        .in("order_id", orderIds);
      if (error) throw error;
      return NextResponse.json({ ok: true, assigned: 0, removed: orderIds.length });
    }

    const { data: assignee, error: assigneeError } =
      await service.auth.admin.getUserById(parsed.data.assignee_id);
    if (assigneeError || !assignee?.user?.email) {
      return NextResponse.json(
        { ok: false, error: "This user no longer exists." },
        { status: 400 }
      );
    }

    const assignedAt = new Date().toISOString();
    const { error } = await service.from("dispatch_plan_assignments").upsert(
      orderIds.map((orderId) => ({
        plan_id: plan.id,
        order_id: orderId,
        assignee_id: assignee.user.id,
        assignee_email: assignee.user.email,
        assigned_by_email: identity.email,
        assigned_at: assignedAt,
      })),
      { onConflict: "plan_id,order_id" }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, assigned: orderIds.length, removed: 0 });
  } catch (error) {
    console.error("DISPATCH ASSIGN ERROR", error);
    return NextResponse.json(
      { ok: false, error: "The orders could not be assigned." },
      { status: 500 }
    );
  }
}
