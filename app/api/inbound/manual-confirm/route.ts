import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";

export const runtime = "nodejs";

const manualInboundSchema = z.object({
  operation_id: z.string().uuid().optional(),
  device: z.string().uuid(),
  box_no: z.string().trim().min(1).max(200),
  floor: z.string().trim().max(50).optional().nullable(),
  imeis: z.array(z.unknown()).min(1).max(50000),
  shipment_ref: z.string().trim().max(500).optional().nullable(),
});

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanImeis(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value).replace(/\D/g, ""))
        .filter((value) => value.length === 15)
    )
  );
}

export async function POST(req: Request) {
  try {
    const parsed = manualInboundSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const imeis = cleanImeis(parsed.data.imeis);
    if (imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid 15-digit IMEIs found" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const operationId = parsed.data.operation_id || crypto.randomUUID();
    const { data, error } = await serviceClient().rpc(
      "confirm_inbound_batch",
      {
        p_operation_id: operationId,
        p_actor_id: identity.userId,
        p_actor: identity.email,
        p_vendor: "manual",
        p_source: "manual",
        p_shipment_ref: parsed.data.shipment_ref || null,
        p_labels: [
          {
            device_id: parsed.data.device,
            box_no: parsed.data.box_no,
            floor: parsed.data.floor || "",
            imeis,
          },
        ],
      }
    );

    if (error) {
      console.error("MANUAL INBOUND COMMAND ERROR", error);
      const conflict = error.code === "23505" || error.code === "40001";
      return NextResponse.json(
        {
          ok: false,
          error: conflict
            ? "Inbound inventory changed. Please preview and try again."
            : error.code === "22023" || error.code === "P0002"
              ? "Invalid input"
              : "Manual confirmation failed",
        },
        {
          status:
            error.code === "22023" || error.code === "P0002"
              ? 400
              : conflict
                ? 409
                : 500,
        }
      );
    }

    if (data?.code === "ALL_IMEIS_ALREADY_IN_STOCK") {
      return NextResponse.json(
        {
          ok: true,
          operation_id: data.operation_id || operationId,
          inserted: 0,
          skipped_existing:
            data.totals?.skipped_existing_imeis || imeis.length,
          batch_id: null,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      operation_id: data.operation_id || operationId,
      inserted: data.totals?.inserted_imeis || 0,
      skipped_existing: data.totals?.skipped_existing_imeis || 0,
      batch_id: data.batch_id,
    });
  } catch (error) {
    console.error("MANUAL INBOUND CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Manual confirmation failed" },
      { status: 500 }
    );
  }
}
