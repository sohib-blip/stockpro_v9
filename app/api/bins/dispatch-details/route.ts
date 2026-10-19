import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/auth";
import { loadDispatchInventoryItems } from "@/app/api/dispatch-planning/_server";
import {
  findKinesisNameConflict,
  parseDispatchDimensions,
  parseKinesisNames,
} from "@/lib/dispatch-dimensions-input";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// Dispatch dimensions and Kinesis names of a device bin.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonBodyWithinLimit(req, MAX_BODY_BYTES);
    body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? reply(413, "Device bin request is too large")
      : reply(400, "Invalid device bin request");
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID_PATTERN.test(id)) return reply(400, "A valid device bin is required");

  const dimensions = parseDispatchDimensions(body);
  if (!dimensions.ok) return reply(400, dimensions.error);
  const kinesisNames = parseKinesisNames(body.kinesisNames);
  if (!kinesisNames.ok) return reply(400, kinesisNames.error);

  try {
    const inventory = await loadDispatchInventoryItems();
    if (!inventory.available) {
      return reply(503, "Dimensions cannot be saved yet. Apply the latest database migration.");
    }
    const device = inventory.items.find((item) => item.kind === "device" && item.id === id);
    if (!device) return reply(404, "This device bin no longer exists");

    if (kinesisNames.names) {
      const conflict = findKinesisNameConflict(
        { kind: "device", id, kinesisNames: kinesisNames.names },
        inventory.items
      );
      if (conflict) return reply(409, conflict);
    }

    const update: Record<string, unknown> = {};
    if (dimensions.dimensions !== undefined) {
      update.length_cm = dimensions.dimensions?.lengthCm ?? null;
      update.width_cm = dimensions.dimensions?.widthCm ?? null;
      update.height_cm = dimensions.dimensions?.heightCm ?? null;
    }
    if (kinesisNames.names) update.kinesis_names = kinesisNames.names;
    if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

    const { error } = await supabaseService().from("bins").update(update).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DEVICE BIN DISPATCH DETAILS ERROR", error);
    return reply(500, "The device bin could not be saved");
  }
}
