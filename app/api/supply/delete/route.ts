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

const supplyDeleteSchema = z.object({
  operation_id: z.string().uuid().optional(),
  id: z.string().uuid(),
});

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function DELETE(req: Request) {
  try {
    const parsed = supplyDeleteSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid supply deletion" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const { data, error } = await serviceClient().rpc(
      "delete_supply_order",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_supply_id: parsed.data.id,
      }
    );

    if (error) {
      console.error("SUPPLY DELETE COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Supply delete failed"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("SUPPLY DELETE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Supply delete failed" },
      { status: 500 }
    );
  }
}
