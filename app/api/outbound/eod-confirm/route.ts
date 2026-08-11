import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";

export const runtime = "nodejs";

const outboundCommandSchema = z.object({
  operation_id: z.string().uuid().optional(),
  imeis: z.array(z.string().regex(/^\d{15}$/)).min(1).max(50_000),
  shipment_ref: z.string().trim().max(500).optional().nullable(),
  source: z.enum(["manual", "excel"]).optional(),
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
    const parsed = outboundCommandSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid outbound confirmation" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const imeis = Array.from(new Set(parsed.data.imeis));
    const { data, error } = await serviceClient().rpc(
      "confirm_outbound_batch",
      {
        p_imeis: imeis,
        p_actor: identity.email,
        p_actor_id: identity.userId,
        p_shipment_ref: parsed.data.shipment_ref || null,
        p_source: parsed.data.source || "manual",
        p_operation_id: operationId,
      }
    );

    if (error) {
      console.error("OUTBOUND COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Outbound confirmation failed"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("OUTBOUND CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Outbound confirmation failed" },
      { status: 500 }
    );
  }
}
