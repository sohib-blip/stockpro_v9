import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "@/lib/inventory-command-error";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const manualOutboundSchema = z.object({
  operation_id: z.string().uuid().optional(),
  shipment_ref: z.string().trim().max(500).optional().nullable(),
  comment: z.string().trim().max(1000).optional().nullable(),
  preview: z.union([z.literal("0"), z.literal("1")]).optional(),
  lines: z
    .array(
      z.object({
        accessory_id: z.string().uuid(),
        qty: z.coerce.number().int().positive().max(9_999_999),
      })
    )
    .min(1)
    .max(500),
});

export async function POST(req: Request) {
  try {
    const parsed = manualOutboundSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid accessory outbound request" },
        { status: 400 }
      );
    }

    const { shipment_ref, comment, lines, preview } = parsed.data;
    const identity = getApiIdentity(req);

    const grouped = new Map<string, number>();

    for (const line of lines) {
      grouped.set(
        line.accessory_id,
        (grouped.get(line.accessory_id) || 0) + Number(line.qty)
      );
    }

    if (preview === "1") {
      const ids = Array.from(grouped.keys());
      const { data: accessories, error } = await supabase
        .from("accessory_bins")
        .select("id, name, current_stock")
        .in("id", ids);

      if (error) throw error;

      if ((accessories || []).length !== ids.length) {
        return NextResponse.json(
          {
            ok: false,
            error: "One or more accessories are unavailable. Preview again.",
          },
          { status: 400 }
        );
      }

      for (const item of accessories || []) {
        const needed = grouped.get(item.id) || 0;

        if (Number(item.current_stock || 0) < needed) {
          return NextResponse.json(
            {
              ok: false,
              error: `Not enough stock for ${item.name}. Stock: ${item.current_stock}, needed: ${needed}`,
            },
            { status: 400 }
          );
        }
      }

      return NextResponse.json({
        ok: true,
        preview: true,
        rows: (accessories || []).map((item: any) => {
          const qty = grouped.get(item.id) || 0;

          return {
            accessory_bin_id: item.id,
            accessory: item.name,
            qty,
            current_stock: Number(item.current_stock || 0),
            after_stock: Number(item.current_stock || 0) - qty,
          };
        }),
      });
    }

    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const { data, error: commandError } = await supabase.rpc(
      "confirm_accessory_outbound",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_source: "manual",
        p_shipment_ref: shipment_ref || null,
        p_note: comment || null,
        p_lines: Array.from(grouped, ([accessory_bin_id, qty]) => ({
          accessory_bin_id,
          qty,
        })),
      }
    );

    if (commandError) {
      console.error("MANUAL ACCESSORY COMMAND ERROR", commandError);
      return NextResponse.json(
        {
          ok: false,
          error: inventoryCommandErrorMessage(
            commandError,
            "Manual outbound failed"
          ),
        },
        { status: inventoryCommandErrorStatus(commandError) }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("MANUAL ACCESSORY OUTBOUND ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Manual outbound failed" },
      { status: 500 }
    );
  }
}
