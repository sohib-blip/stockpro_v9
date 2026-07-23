import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";

export const runtime = "nodejs";

type LabelPayload = {
  device_id?: unknown;
  box_no?: unknown;
  floor?: unknown;
  imeis?: unknown;
};

type NormalizedLabel = {
  device_id: string;
  box_no: string;
  floor: string;
  imeis: string[];
};

const inboundCommandSchema = z.object({
  operation_id: z.string().uuid().optional(),
  labels: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  vendor: z.string().trim().max(200).optional().nullable(),
  shipment_ref: z.string().trim().max(500).optional().nullable(),
});

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function cleanImeis(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value).replace(/\D/g, ""))
        .filter((value) => value.length === 15)
    )
  );
}

function normalizeLabels(labels: LabelPayload[]): NormalizedLabel[] {
  return labels
    .map((raw) => ({
      device_id: String(raw.device_id || "").trim(),
      box_no: String(raw.box_no || "").trim(),
      floor: String(raw.floor || "").trim(),
      imeis: cleanImeis(raw.imeis),
    }))
    .filter(
      (label) =>
        label.device_id && label.box_no && label.imeis.length > 0
    );
}

function rpcErrorStatus(code?: string) {
  if (code === "22023" || code === "P0002") return 400;
  if (code === "23505" || code === "40001") return 409;
  return 500;
}

export async function POST(req: Request) {
  try {
    const parsed = inboundCommandSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid inbound confirmation" },
        { status: 400 }
      );
    }

    const normalizedLabels = normalizeLabels(
      parsed.data.labels as LabelPayload[]
    );
    if (normalizedLabels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid boxes or 15-digit IMEIs were found" },
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
        p_vendor: parsed.data.vendor || "unknown",
        p_source: "excel",
        p_shipment_ref: parsed.data.shipment_ref || null,
        p_labels: normalizedLabels,
      }
    );

    if (error) {
      console.error("INBOUND COMMAND ERROR", error);
      const missingBins = error.message.match(
        /INBOUND_BINS_NOT_FOUND:(.+)$/i
      )?.[1]?.trim();
      return NextResponse.json(
        {
          ok: false,
          error: missingBins
            ? `Bins not found: ${missingBins}`
            : error.code === "23505" || error.code === "40001"
              ? "Inbound inventory changed. Please preview and try again."
              : error.code === "22023" || error.code === "P0002"
                ? "Invalid inbound confirmation"
                : "Inbound confirmation failed",
        },
        { status: rpcErrorStatus(error.code) }
      );
    }

    if (data?.code === "ALL_IMEIS_ALREADY_IN_STOCK") {
      return NextResponse.json(data, { status: 409 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("INBOUND CONFIRM ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Inbound confirmation failed" },
      { status: 500 }
    );
  }
}
