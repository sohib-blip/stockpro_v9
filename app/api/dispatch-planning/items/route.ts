import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import {
  loadDispatchInventoryItems,
  type DispatchInventoryItem,
} from "@/app/api/dispatch-planning/_server";
import { dispatchItemKey, inventoryBaseName } from "@/lib/dispatch-planning";
import {
  findKinesisNameConflict,
  parseDispatchDimensions,
  parseKinesisNames,
  recordAnswersToLabel,
} from "@/lib/dispatch-dimensions-input";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/security/request-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 8 * 1024;
const NOT_INSTALLED =
  "Dimensions cannot be saved yet. Apply the latest database migration.";

function reply(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function toView(item: DispatchInventoryItem) {
  return {
    kind: item.kind,
    id: item.id,
    name: item.name,
    label: inventoryBaseName(item.name) || item.name,
    active: item.active,
    category: item.category,
    lengthCm: item.lengthCm,
    widthCm: item.widthCm,
    heightCm: item.heightCm,
    kinesisNames: item.kinesisNames,
  };
}

// Device Bins and Accessory Inventory records that can carry dimensions.
export async function GET() {
  try {
    const inventory = await loadDispatchInventoryItems();
    if (!inventory.available) return reply(503, NOT_INSTALLED);
    return NextResponse.json(
      { ok: true, items: inventory.items.map(toView) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("DISPATCH ITEMS ERROR", error);
    return reply(500, "Device and accessory records could not be loaded");
  }
}

// Resolves an unknown Kinesis label from Dispatch Planning: stores dimensions
// on an existing device or accessory (remembering the label as one of its
// Kinesis names) or creates a hidden accessory for it.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonBodyWithinLimit(req, MAX_BODY_BYTES);
    body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? reply(413, "Dimension request is too large")
      : reply(400, "Invalid dimension request");
  }

  const label = String(body.label ?? "").replace(/\s+/g, " ").trim();
  if (!label || label.length > 200 || !dispatchItemKey(label)) {
    return reply(400, "The Kinesis label is missing");
  }
  const labelCheck = parseKinesisNames([label]);
  if (!labelCheck.ok) return reply(400, labelCheck.error);

  const dimensions = parseDispatchDimensions(body);
  if (!dimensions.ok) return reply(400, dimensions.error);
  if (!dimensions.dimensions) return reply(400, "Enter the length, width and height");
  const { lengthCm, widthCm, heightCm } = dimensions.dimensions;

  const target = (body.target && typeof body.target === "object" ? body.target : {}) as {
    kind?: unknown;
    id?: unknown;
    category?: unknown;
  };

  try {
    const inventory = await loadDispatchInventoryItems();
    if (!inventory.available) return reply(503, NOT_INSTALLED);
    const service = supabaseService();
    const updatedBy = getApiIdentity(req).email;

    if (target.kind === "new_accessory") {
      const existing = inventory.items.find(
        (item) =>
          item.kind === "accessory" &&
          dispatchItemKey(item.name) === dispatchItemKey(label)
      );
      if (existing) {
        return reply(409, `An accessory named "${existing.name}" already exists. Select it instead.`);
      }
      const conflict = findKinesisNameConflict(
        { kind: "accessory", kinesisNames: [label] },
        inventory.items
      );
      if (conflict) return reply(409, conflict);

      const category = ["Consumables", "Harness", "Vision", "Items"].includes(String(target.category))
        ? String(target.category)
        : "Items";
      const { error } = await service.from("accessory_bins").insert({
        name: label,
        category,
        current_stock: 0,
        minimum_stock: 0,
        active: false,
        length_cm: lengthCm,
        width_cm: widthCm,
        height_cm: heightCm,
        kinesis_names: [label],
      });
      if (error) throw error;
      console.info("DISPATCH DIMENSIONS ADDED", { label, kind: "new_accessory", updatedBy });
      return NextResponse.json({
        ok: true,
        message: `${label} was added as a hidden accessory with its dimensions.`,
      });
    }

    if (target.kind !== "device" && target.kind !== "accessory") {
      return reply(400, "Choose the device or accessory this label refers to");
    }
    const record = inventory.items.find(
      (item) => item.kind === target.kind && item.id === String(target.id ?? "")
    );
    if (!record) return reply(404, "This device or accessory no longer exists");

    const kinesisNames = recordAnswersToLabel(record, label)
      ? record.kinesisNames
      : [...record.kinesisNames, label];
    const conflict = findKinesisNameConflict(
      { kind: record.kind, id: record.id, kinesisNames },
      inventory.items
    );
    if (conflict) return reply(409, conflict);

    const { error } = await service
      .from(record.kind === "device" ? "bins" : "accessory_bins")
      .update({
        length_cm: lengthCm,
        width_cm: widthCm,
        height_cm: heightCm,
        kinesis_names: kinesisNames,
      })
      .eq("id", record.id);
    if (error) throw error;

    console.info("DISPATCH DIMENSIONS ADDED", { label, kind: record.kind, id: record.id, updatedBy });
    const recordLabel = inventoryBaseName(record.name) || record.name;
    return NextResponse.json({
      ok: true,
      message: `${recordLabel} now has dimensions and is recognised as "${label}".`,
    });
  } catch (error) {
    console.error("DISPATCH DIMENSIONS ERROR", error);
    return reply(500, "The dimensions could not be saved");
  }
}
