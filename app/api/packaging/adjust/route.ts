import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import { packagingAdjustmentSchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = packagingAdjustmentSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging stock adjustment" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService().rpc(
      "adjust_packaging_stock",
      {
        p_operation_id: parsed.data.operation_id,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_packaging_type_id: parsed.data.packaging_type_id,
        p_mode: parsed.data.mode,
        p_quantity: parsed.data.quantity,
        p_reason: parsed.data.reason,
      }
    );

    if (error) {
      console.error("PACKAGING ADJUST COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Packaging stock adjustment failed"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("PACKAGING ADJUST ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging stock adjustment failed" },
      { status: 500 }
    );
  }
}
