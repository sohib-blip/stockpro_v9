import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  accessoryWriteError,
  parseAccessoryBinInput,
} from "@/lib/accessory-bin-input";
import {
  isMissingDispatchColumns,
  loadDispatchInventoryItems,
} from "@/app/api/dispatch-planning/_server";
import {
  findKinesisNameConflict,
  parseDispatchDimensions,
  parseKinesisNames,
} from "@/lib/dispatch-dimensions-input";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const input = parseAccessoryBinInput(body);
  if (!input.ok) {
    return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  }

  // Dispatch dimensions and Kinesis names are only changed when sent.
  const value = body as Record<string, unknown>;
  const dimensions = parseDispatchDimensions(value);
  if (!dimensions.ok) {
    return NextResponse.json({ ok: false, error: dimensions.error }, { status: 400 });
  }
  const kinesisNames = parseKinesisNames(value.kinesisNames);
  if (!kinesisNames.ok) {
    return NextResponse.json({ ok: false, error: kinesisNames.error }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    name: input.name,
    current_stock: input.currentStock,
    minimum_stock: input.minimumStock,
    category: input.category,
  };
  if (dimensions.dimensions !== undefined) {
    update.length_cm = dimensions.dimensions?.lengthCm ?? null;
    update.width_cm = dimensions.dimensions?.widthCm ?? null;
    update.height_cm = dimensions.dimensions?.heightCm ?? null;
  }
  if (kinesisNames.names) {
    const inventory = await loadDispatchInventoryItems().catch(() => null);
    if (inventory?.available) {
      const conflict = findKinesisNameConflict(
        { kind: "accessory", id, kinesisNames: kinesisNames.names },
        inventory.items
      );
      if (conflict) {
        return NextResponse.json({ ok: false, error: conflict }, { status: 409 });
      }
    }
    update.kinesis_names = kinesisNames.names;
  }

  const { error } = await supabase.from("accessory_bins").update(update).eq("id", id);

  if (error) {
    if (isMissingDispatchColumns(error)) {
      return NextResponse.json(
        { ok: false, error: "Dimensions cannot be saved yet. Apply the latest database migration." },
        { status: 503 }
      );
    }
    const failure = accessoryWriteError(error, input.name);
    return NextResponse.json(
      { ok: false, error: failure.error },
      { status: failure.status }
    );
  }

  return NextResponse.json({ ok: true });
}
