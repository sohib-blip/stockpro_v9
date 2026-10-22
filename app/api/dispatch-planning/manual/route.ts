import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  manualOutboundName,
  planManualPackagingOutbound,
} from "@/lib/dispatch-planning";
import {
  loadDispatchPackagingOptions,
  loadDispatchPackagingRules,
} from "@/app/api/dispatch-planning/_server";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  operation_id: z.string().uuid(),
  preview: z.boolean().default(false),
  reference: z.string().trim().max(120).optional().default(""),
  comment: z.string().trim().max(120).optional().default(""),
  lines: z
    .array(
      z.object({
        packagingTypeId: z.string().uuid(),
        quantity: z.number().int().min(1).max(1_000_000),
      })
    )
    .min(1)
    .max(100),
});

// Manual packaging outbound: previewed and confirmed like a daily dispatch
// (same history, undo and packaging rules) with one pseudo-order.
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid manual packaging outbound." },
        { status: 400 }
      );
    }

    const { operation_id: operationId, preview, reference, comment, lines } = parsed.data;
    const [packages, packagingRules] = await Promise.all([
      loadDispatchPackagingOptions(),
      loadDispatchPackagingRules(),
    ]);
    const orderId = `MANUAL-${operationId.slice(0, 8).toUpperCase()}`;
    const plan = planManualPackagingOutbound(orderId, lines, packages, packagingRules);

    if (preview || plan.blockers.length > 0) {
      return NextResponse.json(
        {
          ok: plan.blockers.length === 0,
          preview: true,
          error:
            plan.blockers.length > 0
              ? "Packaging stock or the selected formats need attention before confirmation."
              : undefined,
          plan,
        },
        { status: plan.blockers.length > 0 && !preview ? 409 : 200 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService().rpc("confirm_dispatch_batch", {
      p_operation_id: operationId,
      p_actor_id: identity.userId,
      p_actor: identity.email,
      p_source_sha256: createHash("sha256")
        .update(`manual-packaging-outbound:${operationId}`)
        .digest("hex"),
      p_source_filename: manualOutboundName(reference, comment),
      p_source_generated_at: null,
      p_orders: plan.orders,
      p_package_usage: plan.packageUsage,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(error, "Manual packaging outbound failed."),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("MANUAL PACKAGING OUTBOUND ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Manual packaging outbound failed." },
      { status: 500 }
    );
  }
}
