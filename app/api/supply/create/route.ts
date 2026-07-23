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

const supplyCreateSchema = z
  .object({
    operation_id: z.string().uuid().optional(),
    from_office: z.string().regex(/^[A-Z]{2}$/),
    to_office: z.string().regex(/^[A-Z]{2}$/),
    comment: z.string().trim().max(2000).optional().nullable(),
    items: z
      .array(
        z.object({
          product_id: z.string().uuid().optional().nullable(),
          product_type: z.enum(["DEVICE", "ACCESSORY"]),
          product_name: z.string().trim().min(1).max(200),
          qty: z.coerce.number().int().positive().max(9_999_999),
        })
      )
      .min(1)
      .max(500),
  })
  .refine((value) => value.from_office !== value.to_office, {
    message: "Offices must be different",
  });

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function makeOrderNumber() {
  const now = new Date();
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `SUP-${date}-${suffix}`;
}

export async function POST(req: Request) {
  try {
    const parsed = supplyCreateSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid supply order" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const { data, error } = await serviceClient().rpc(
      "create_supply_order",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_order_number: makeOrderNumber(),
        p_from_office: parsed.data.from_office,
        p_to_office: parsed.data.to_office,
        p_comment: parsed.data.comment || null,
        p_items: parsed.data.items,
      }
    );

    if (error) {
      console.error("SUPPLY CREATE COMMAND ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            error,
            "Supply create failed"
          ),
        },
        { status: inventoryCommandErrorStatus(error) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("SUPPLY CREATE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Supply create failed" },
      { status: 500 }
    );
  }
}
