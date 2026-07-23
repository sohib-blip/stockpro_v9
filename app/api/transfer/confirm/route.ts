import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";

export const runtime = "nodejs";

const transferCommandSchema = z.object({
  operation_id: z.string().uuid().optional(),
  box_codes: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  source_bin_id: z.string().uuid(),
  target_floor: z.string().trim().min(1).max(50),
});

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const parsed = transferCommandSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid transfer confirmation" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const boxCodes = Array.from(new Set(parsed.data.box_codes));
    const { data, error } = await serviceClient().rpc(
      "confirm_transfer_batch",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_source_bin_id: parsed.data.source_bin_id,
        p_target_floor: parsed.data.target_floor,
        p_box_codes: boxCodes,
      }
    );

    if (error) {
      console.error("TRANSFER COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(error, "Transfer failed"),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("TRANSFER CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Transfer failed" },
      { status: 500 }
    );
  }
}
