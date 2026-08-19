import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import { readJsonBodyWithinLimit } from "@/lib/security/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  operation_id: z.string().uuid(),
  batch_id: z.string().uuid(),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(
      await readJsonBodyWithinLimit(req, 16 * 1024).catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid dispatch undo request." },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService().rpc("undo_dispatch_batch", {
      p_operation_id: parsed.data.operation_id,
      p_actor_id: identity.userId,
      p_actor: identity.email,
      p_batch_id: parsed.data.batch_id,
    });
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Dispatch batch could not be undone."
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("DISPATCH UNDO ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Dispatch batch could not be undone." },
      { status: 500 }
    );
  }
}
