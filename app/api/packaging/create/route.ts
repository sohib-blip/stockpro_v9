import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";
import { packagingCreateSchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = packagingCreateSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging details" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { operation_id, ...details } = parsed.data;
    const { data, error } = await supabaseService().rpc(
      "save_packaging_inventory",
      {
        p_operation_id: operation_id || crypto.randomUUID(),
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_packaging_type_id: null,
        p_code: details.code,
        p_name: details.name,
        p_category: details.category,
        p_length_cm: details.length_cm,
        p_width_cm: details.width_cm,
        p_height_cm: details.height_cm,
        p_on_hand_stock: details.on_hand_stock,
        p_minimum_stock: details.minimum_stock,
      }
    );

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "A packaging format with this code or name already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Packaging format could not be created"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("PACKAGING CREATE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging format could not be created" },
      { status: 500 }
    );
  }
}
