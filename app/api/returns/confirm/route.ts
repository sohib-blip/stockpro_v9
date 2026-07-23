import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const returnCommandSchema = z.object({
  operation_id: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
      })
    )
    .min(1)
    .max(500),
  target_box: z.string().trim().min(1).max(200),
  target_floor: z.string().trim().max(50).nullish(),
  return_ref: z.string().trim().max(500).nullish(),
  return_type: z.string().trim().min(1).max(200),
  return_reason: z.string().trim().min(1).max(1000),
});

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function commandErrorStatus(code?: string) {
  if (code === "22023" || code === "P0002") return 400;
  if (code === "23505" || code === "40001") return 409;
  return 500;
}

export async function POST(req: Request) {
  try {
    const parsed = returnCommandSchema.safeParse(
      await req.json().catch(() => null)
    );

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid return confirmation" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const itemIds = Array.from(
      new Set(parsed.data.items.map((item) => item.item_id))
    );
    const { data, error } = await serviceClient().rpc(
      "confirm_return_batch",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_item_ids: itemIds,
        p_target_box: parsed.data.target_box,
        p_target_floor: parsed.data.target_floor || null,
        p_return_ref: parsed.data.return_ref || null,
        p_return_type: parsed.data.return_type,
        p_return_reason: parsed.data.return_reason,
      }
    );

    if (error) {
      console.error("RETURN COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error:
            error.code === "40001"
              ? "The return state changed. Please preview and try again."
              : error.code === "P0002"
                ? "One or more return items no longer exist."
                : error.code === "22023"
                  ? "Invalid return confirmation"
                  : "Return confirmation failed",
        },
        { status: commandErrorStatus(error.code) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("RETURN CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Return confirmation failed" },
      { status: 500 }
    );
  }
}
