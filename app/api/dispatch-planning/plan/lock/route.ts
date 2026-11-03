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
  // release: the planner (or an admin) ends the planning without a deduction.
  // takeover: an admin becomes today's planner, assignments are kept.
  action: z.enum(["release", "takeover"]),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(
      await readJsonBodyWithinLimit(req, 10_000).catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid dispatch planning action." },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const isAdmin = identity.role === "admin";
    const service = supabaseService();
    const plan = await loadDispatchPlanById(service, parsed.data.plan_id);
    if (!plan || !isDispatchPlanLocking(plan, dispatchToday())) {
      return NextResponse.json(
        { ok: false, error: "This dispatch planning is already closed." },
        { status: 409 }
      );
    }

    const isPlanner = plan.planner_id === identity.userId;
    if (parsed.data.action === "takeover" ? !isAdmin || isPlanner : !isAdmin && !isPlanner) {
      return NextResponse.json(
        {
          ok: false,
          error:
            parsed.data.action === "takeover"
              ? "Only an admin can take over another person's dispatch planning."
              : `${plan.planner_email} is doing today's dispatch planning.`,
        },
        { status: 403 }
      );
    }

    const update =
      parsed.data.action === "takeover"
        ? { planner_id: identity.userId, planner_email: identity.email }
        : {
            status: "RELEASED",
            closed_at: new Date().toISOString(),
            closed_by_email: identity.email,
          };
    const { data, error } = await service
      .from("dispatch_plans")
      .update(update)
      .eq("id", plan.id)
      .eq("status", "OPEN")
      .select("id");
    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json(
        { ok: false, error: "This dispatch planning is already closed." },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DISPATCH PLAN LOCK ERROR", error);
    return NextResponse.json(
      { ok: false, error: "The dispatch planning could not be updated." },
      { status: 500 }
    );
  }
}
