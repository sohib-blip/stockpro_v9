import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { planDispatchPackaging } from "@/lib/dispatch-planning";
import { verifyDispatchPreviewToken } from "@/lib/dispatch-preview-token";
import { loadDispatchPackagingOptions } from "@/app/api/dispatch-planning/_server";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import { readJsonBodyWithinLimit } from "@/lib/security/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  operation_id: z.string().uuid(),
  preview_token: z.string().min(50).max(1_500_000),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(
      await readJsonBodyWithinLimit(req, 1_600_000).catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid dispatch confirmation." },
        { status: 400 }
      );
    }

    let preview;
    try {
      preview = verifyDispatchPreviewToken(parsed.data.preview_token);
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "Invalid dispatch preview." },
        { status: 400 }
      );
    }

    const plan = planDispatchPackaging(
      preview.orders,
      await loadDispatchPackagingOptions()
    );
    if (plan.blockers.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Packaging stock changed or a recommendation is no longer valid. Preview again.",
          blockers: plan.blockers,
        },
        { status: 409 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService().rpc(
      "confirm_dispatch_batch",
      {
        p_operation_id: parsed.data.operation_id,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_source_sha256: preview.sourceHash,
        p_source_filename: preview.sourceFilename,
        p_source_generated_at: preview.sourceGeneratedAt,
        p_orders: plan.orders,
        p_package_usage: plan.packageUsage,
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Daily dispatch confirmation failed."
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("DISPATCH CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Daily dispatch confirmation failed." },
      { status: 500 }
    );
  }
}
