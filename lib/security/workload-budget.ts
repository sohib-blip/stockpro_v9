import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { supabaseService } from "../auth";

type WorkloadPolicy = {
  routeClass: string;
  windowSeconds: number;
  principalLimit: number;
  sourceLimit: number;
  globalLimit: number;
  principalConcurrency: number;
  routeConcurrency: number;
  globalConcurrency: number;
  leaseSeconds: number;
};

export const WORKLOAD_POLICIES = {
  login: {
    routeClass: "auth.login",
    windowSeconds: 60,
    principalLimit: 10,
    sourceLimit: 30,
    globalLimit: 300,
    principalConcurrency: 4,
    routeConcurrency: 40,
    globalConcurrency: 60,
    leaseSeconds: 20,
  },
  dashboardExport: {
    routeClass: "export.stock",
    windowSeconds: 60,
    principalLimit: 3,
    sourceLimit: 10,
    globalLimit: 20,
    principalConcurrency: 1,
    routeConcurrency: 2,
    globalConcurrency: 6,
    leaseSeconds: 120,
  },
  countSheetExport: {
    routeClass: "export.count-sheet",
    windowSeconds: 60,
    principalLimit: 2,
    sourceLimit: 5,
    globalLimit: 10,
    principalConcurrency: 1,
    routeConcurrency: 1,
    globalConcurrency: 6,
    leaseSeconds: 180,
  },
  outboundPreview: {
    routeClass: "outbound.preview",
    windowSeconds: 60,
    principalLimit: 20,
    sourceLimit: 40,
    globalLimit: 100,
    principalConcurrency: 2,
    routeConcurrency: 4,
    globalConcurrency: 12,
    leaseSeconds: 60,
  },
  shipmentPdf: {
    routeClass: "outbound.shipment-pdf",
    windowSeconds: 60,
    principalLimit: 10,
    sourceLimit: 20,
    globalLimit: 50,
    principalConcurrency: 1,
    routeConcurrency: 2,
    globalConcurrency: 8,
    leaseSeconds: 60,
  },
  returnsHistory: {
    routeClass: "returns.history",
    windowSeconds: 60,
    principalLimit: 60,
    sourceLimit: 120,
    globalLimit: 600,
    principalConcurrency: 4,
    routeConcurrency: 8,
    globalConcurrency: 30,
    leaseSeconds: 15,
  },
  transferPreview: {
    routeClass: "transfer.preview",
    windowSeconds: 60,
    principalLimit: 30,
    sourceLimit: 60,
    globalLimit: 200,
    principalConcurrency: 3,
    routeConcurrency: 6,
    globalConcurrency: 20,
    leaseSeconds: 30,
  },
} as const satisfies Record<string, WorkloadPolicy>;

export type WorkloadName = keyof typeof WORKLOAD_POLICIES;

type WorkloadIdentity = {
  principal?: string | null;
  source?: string | null;
};

export type WorkloadAdmission =
  | {
      ok: true;
      leaseId: string;
    }
  | {
      ok: false;
      status: 429 | 503;
      reason: "rate_limited" | "concurrency_limited" | "budget_unavailable";
      retryAfterSeconds: number;
    };

function trustedSource(req: Request) {
  const raw =
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("x-real-ip");
  const candidate = raw?.split(",")[0]?.trim() || "";
  return isIP(candidate) ? candidate : "unknown";
}

function budgetSecret() {
  return (
    process.env.WORKLOAD_BUDGET_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null
  );
}

function digestIdentity(value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(value.trim().toLowerCase().slice(0, 512))
    .digest("hex");
}

export async function acquireWorkloadLease(
  req: Request,
  workload: WorkloadName,
  identity: WorkloadIdentity = {}
): Promise<WorkloadAdmission> {
  const policy = WORKLOAD_POLICIES[workload];
  const secret = budgetSecret();

  if (!secret) {
    console.error("Workload admission unavailable: missing hash secret");
    return {
      ok: false,
      status: 503,
      reason: "budget_unavailable",
      retryAfterSeconds: 5,
    };
  }

  const principal =
    identity.principal ||
    req.headers.get("x-stockpro-user-id") ||
    "anonymous";
  const source = identity.source || trustedSource(req);

  try {
    const { data, error } = await supabaseService().rpc(
      "acquire_workload_lease",
      {
        p_route_class: policy.routeClass,
        p_principal_hash: digestIdentity(principal, secret),
        p_source_hash: digestIdentity(source, secret),
        p_window_seconds: policy.windowSeconds,
        p_principal_limit: policy.principalLimit,
        p_source_limit: policy.sourceLimit,
        p_global_limit: policy.globalLimit,
        p_principal_concurrency: policy.principalConcurrency,
        p_route_concurrency: policy.routeConcurrency,
        p_global_concurrency: policy.globalConcurrency,
        p_lease_seconds: policy.leaseSeconds,
      }
    );

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      console.error(
        "Workload admission failed closed",
        error?.message || "empty response"
      );
      return {
        ok: false,
        status: 503,
        reason: "budget_unavailable",
        retryAfterSeconds: 5,
      };
    }

    if (!row.allowed || !row.lease_id) {
      const reason =
        row.reason === "rate_limited"
          ? "rate_limited"
          : "concurrency_limited";
      return {
        ok: false,
        status: reason === "rate_limited" ? 429 : 503,
        reason,
        retryAfterSeconds: Math.max(
          1,
          Math.min(300, Number(row.retry_after_seconds) || 5)
        ),
      };
    }

    return { ok: true, leaseId: String(row.lease_id) };
  } catch (error) {
    console.error("Workload admission failed closed", error);
    return {
      ok: false,
      status: 503,
      reason: "budget_unavailable",
      retryAfterSeconds: 5,
    };
  }
}

export async function releaseWorkloadLease(leaseId: string) {
  try {
    const { error } = await supabaseService().rpc("release_workload_lease", {
      p_lease_id: leaseId,
    });
    if (error) {
      console.error("Unable to release workload lease", error.message);
    }
  } catch (error) {
    console.error("Unable to release workload lease", error);
  }
}

export function workloadRejectionResponse(
  admission: Extract<WorkloadAdmission, { ok: false }>
) {
  const message =
    admission.reason === "rate_limited"
      ? "Too many requests. Please try again shortly."
      : admission.reason === "concurrency_limited"
        ? "This operation is temporarily busy. Please try again shortly."
        : "Workload protection is temporarily unavailable.";

  return NextResponse.json(
    {
      ok: false,
      error: message,
      code: admission.reason,
    },
    {
      status: admission.status,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(admission.retryAfterSeconds),
      },
    }
  );
}
