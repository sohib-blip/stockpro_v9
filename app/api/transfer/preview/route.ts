import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";

const MAX_PREVIEW_BOXES = 100;
const MAX_TRANSFER_PREVIEW_BYTES = 64 * 1024;

const previewSchema = z.object({
  box_codes: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(MAX_PREVIEW_BOXES),
  source_bin_id: z.string().uuid(),
  target_floor: z.string().trim().min(1).max(50),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await readJsonBodyWithinLimit(req, MAX_TRANSFER_PREVIEW_BYTES);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof PayloadTooLargeError
            ? "Transfer preview request is too large"
            : "Invalid transfer preview request",
      },
      { status: error instanceof PayloadTooLargeError ? 413 : 400 }
    );
  }

  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Select between 1 and ${MAX_PREVIEW_BOXES} valid boxes.`,
      },
      { status: 400 }
    );
  }

  const boxCodes = Array.from(new Set(parsed.data.box_codes));
  const identity = getApiIdentity(req);
  const admission = await acquireWorkloadLease(req, "transferPreview", {
    principal: identity.userId,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const { data, error } = await supabaseService().rpc(
      "preview_box_transfer",
      {
        p_box_codes: boxCodes,
        p_source_bin_id: parsed.data.source_bin_id,
        p_target_floor: parsed.data.target_floor,
      }
    );

    if (error) throw error;
    const boxes = data || [];

    if (boxes.length !== boxCodes.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "One or more boxes were not found in the selected device.",
        },
        { status: 400 }
      );
    }

    for (const box of boxes) {
      if (box.current_floor === parsed.data.target_floor) {
        return NextResponse.json(
          {
            ok: false,
            error: `Box ${box.box_code} is already on floor ${parsed.data.target_floor}.`,
          },
          { status: 400 }
        );
      }

      if (Number(box.imei_count || 0) === 0) {
        return NextResponse.json(
          { ok: false, error: `Box ${box.box_code} is empty.` },
          { status: 400 }
        );
      }
    }

    const result = boxes.map((box: any) => ({
      box_code: box.box_code,
      device: box.device || "Unknown",
      current_floor: box.current_floor,
      imei_count: Number(box.imei_count || 0),
    }));

    return NextResponse.json({
      ok: true,
      preview: true,
      boxes: result,
      total_boxes: result.length,
      total_items: result.reduce(
        (total: number, box: any) => total + box.imei_count,
        0
      ),
      target_floor: parsed.data.target_floor,
    });
  } catch (error) {
    console.error("TRANSFER PREVIEW ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Transfer preview failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
