import { supabaseService } from "@/lib/auth";
import type { ApiIdentity } from "@/lib/api-identity";
import { brusselsDate } from "@/lib/nrd-time";
import type {
  DispatchPlanAssignment,
  DispatchPlanLabel,
  DispatchPlanOrder,
  DispatchPlanStatus,
} from "@/lib/dispatch-assignments";

type Service = ReturnType<typeof supabaseService>;

export type DispatchPlanRow = {
  id: string;
  plan_date: string;
  status: DispatchPlanStatus;
  planner_id: string | null;
  planner_email: string;
  source_sha256: string;
  source_filename: string;
  orders: DispatchPlanOrder[];
  labels: DispatchPlanLabel[];
  started_at: string;
  closed_at: string | null;
  closed_by_email: string | null;
};

export type DispatchPlanStart =
  | { ok: true; plan_id: string; status: DispatchPlanStatus; resumed: boolean }
  | { ok: false; code: "LOCKED"; planner_email: string; started_at: string }
  | {
      ok: false;
      code: "REPLACE_REQUIRED";
      source_filename: string;
      assignment_count: number;
    }
  | { ok: false; code: "NOT_INSTALLED" };

// Until migration 20261104090000 is applied, Dispatch Planning keeps working
// exactly as before, without assignments or lock.
export function isDispatchPlanMissing(error: { code?: string } | null | undefined) {
  return ["42P01", "42883", "PGRST202", "PGRST205"].includes(String(error?.code || ""));
}

export function dispatchToday() {
  return brusselsDate(new Date());
}

const PLAN_COLUMNS =
  "id,plan_date,status,planner_id,planner_email,source_sha256,source_filename,orders,labels,started_at,closed_at,closed_by_email";

/** Today's plan: the latest one that was not replaced by another workbook. */
export async function loadTodayDispatchPlan(service: Service, today = dispatchToday()) {
  const { data, error } = await service
    .from("dispatch_plans")
    .select(PLAN_COLUMNS)
    .eq("plan_date", today)
    .neq("status", "REPLACED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isDispatchPlanMissing(error)) return { installed: false as const, plan: null };
    throw error;
  }
  return { installed: true as const, plan: (data as DispatchPlanRow | null) ?? null };
}

export async function loadDispatchPlanById(service: Service, planId: string) {
  const { data, error } = await service
    .from("dispatch_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  return (data as DispatchPlanRow | null) ?? null;
}

export async function loadDispatchPlanAssignments(
  service: Service,
  planId: string
): Promise<DispatchPlanAssignment[]> {
  const { data, error } = await service
    .from("dispatch_plan_assignments")
    .select("order_id,assignee_id,assignee_email")
    .eq("plan_id", planId);
  if (error) throw error;
  return (data || []).map((row) => ({
    orderId: String(row.order_id),
    assigneeId: String(row.assignee_id),
    assigneeEmail: String(row.assignee_email),
  }));
}

/** Today's open plan held by another account, if any. */
export async function dispatchPlanHeldByOther(service: Service, identity: ApiIdentity) {
  const { data, error } = await service
    .from("dispatch_plans")
    .select("planner_id,planner_email,started_at")
    .eq("plan_date", dispatchToday())
    .eq("status", "OPEN")
    .maybeSingle();
  if (error) {
    if (isDispatchPlanMissing(error)) return null;
    throw error;
  }
  if (!data || data.planner_id === identity.userId) return null;
  return { plannerEmail: String(data.planner_email), startedAt: String(data.started_at) };
}

export async function startDispatchPlan(
  service: Service,
  identity: ApiIdentity,
  input: {
    sourceHash: string;
    sourceFilename: string;
    orders: DispatchPlanOrder[];
    labels: DispatchPlanLabel[];
    replace: boolean;
  }
): Promise<DispatchPlanStart> {
  const { data, error } = await service.rpc("start_dispatch_plan", {
    p_plan_date: dispatchToday(),
    p_planner_id: identity.userId,
    p_planner_email: identity.email,
    p_source_sha256: input.sourceHash,
    p_source_filename: input.sourceFilename,
    p_orders: input.orders,
    p_labels: input.labels,
    p_replace: input.replace,
  });
  if (error) {
    if (isDispatchPlanMissing(error)) return { ok: false, code: "NOT_INSTALLED" };
    throw error;
  }
  return data as DispatchPlanStart;
}

/** The planner's lock ends when the packaging deduction is confirmed. */
export async function confirmDispatchPlan(
  service: Service,
  identity: ApiIdentity,
  sourceHash: string
) {
  const { error } = await service
    .from("dispatch_plans")
    .update({
      status: "CONFIRMED",
      closed_at: new Date().toISOString(),
      closed_by_email: identity.email,
    })
    .eq("plan_date", dispatchToday())
    .eq("status", "OPEN")
    .eq("planner_id", identity.userId)
    .eq("source_sha256", sourceHash);
  if (error && !isDispatchPlanMissing(error)) throw error;
}

export type DispatchAssignableUser = { id: string; email: string };

/** Every StockPro account that can sign in (banned accounts are left out). */
export async function listDispatchAssignableUsers(
  service: Service
): Promise<DispatchAssignableUser[]> {
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const now = Date.now();
  return (data?.users || [])
    .filter((user) => user.email)
    .filter((user) => {
      const bannedUntil = (user as { banned_until?: string | null }).banned_until;
      return !bannedUntil || Date.parse(bannedUntil) <= now;
    })
    .map((user) => ({ id: user.id, email: String(user.email) }))
    .sort((left, right) => left.email.localeCompare(right.email));
}
