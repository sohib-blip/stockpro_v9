import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const supplyTransitionSchema = z
  .object({
    operation_id: z.string().uuid().optional(),
    id: z.string().uuid(),
    status: z.enum([
      "CREATED",
      "SHIPPED",
      "RECEIVED",
      "IMPORTED",
      "FAILED",
    ]),
    tracking_number: z.string().trim().max(500).optional().nullable(),
    failed_reason: z.string().trim().max(1000).optional().nullable(),
  })
  .refine(
    (value) => value.status !== "FAILED" || Boolean(value.failed_reason),
    { message: "Failure reason is required" }
  );

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function PUT(req: Request) {
  try {
    const parsed = supplyTransitionSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid supply update" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const { data, error } = await serviceClient().rpc(
      "transition_supply_order",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_supply_id: parsed.data.id,
        p_status: parsed.data.status,
        p_tracking_number: parsed.data.tracking_number || null,
        p_failed_reason: parsed.data.failed_reason || null,
      }
    );

    if (error) {
      console.error("SUPPLY UPDATE COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Supply update failed"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    console.error("SUPPLY UPDATE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Supply update failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
