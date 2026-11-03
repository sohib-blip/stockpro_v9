import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  dispatchLabelsForAssignee,
  vehicleLabelsFilename,
} from "@/lib/dispatch-assignments";
import { createDispatchVehicleLabelsDocx } from "@/lib/dispatch-vehicle-labels";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";
import {
  loadDispatchPlanAssignments,
  loadDispatchPlanById,
} from "@/app/api/dispatch-planning/plan/_plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_DOCX_BYTES = 8 * 1024 * 1024;

// Word vehicle registration labels (same L4731 sheet as the full download)
// for the orders assigned to one person; by default the signed-in person.
export async function GET(req: Request) {
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "dispatchLabels", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const params = new URL(req.url).searchParams;
    const planId = z.string().uuid().safeParse(params.get("plan_id"));
    const assignee = params.get("assignee_id");
    const assigneeId = assignee
      ? z.string().uuid().safeParse(assignee)
      : ({ success: true, data: identity.userId } as const);
    if (!planId.success || !assigneeId.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid vehicle label request." },
        { status: 400 }
      );
    }

    const service = supabaseService();
    const plan = await loadDispatchPlanById(service, planId.data);
    if (!plan || plan.status === "REPLACED") {
      return NextResponse.json(
        { ok: false, error: "This dispatch planning no longer exists." },
        { status: 404 }
      );
    }
    const assignments = await loadDispatchPlanAssignments(service, plan.id);
    const labels = dispatchLabelsForAssignee(
      plan.labels || [],
      assignments,
      assigneeId.data
    );
    if (labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No vehicle labels: no device order is assigned to this person." },
        { status: 404 }
      );
    }

    const docx = await createDispatchVehicleLabelsDocx(
      labels.map((label, index) => ({ ...label, sheet: "", row: index + 1 }))
    );
    if (docx.length > MAX_DOCX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Generated label Word document is too large." },
        { status: 413 }
      );
    }
    const email =
      assignments.find((assignment) => assignment.assigneeId === assigneeId.data)
        ?.assigneeEmail || identity.email;

    return new NextResponse(new Uint8Array(docx), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${vehicleLabelsFilename(email)}"`,
        "Cache-Control": "no-store",
        "X-StockPro-Label-Count": String(labels.length),
      },
    });
  } catch (error) {
    console.error("DISPATCH ASSIGNEE LABELS ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Vehicle label generation failed." },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
