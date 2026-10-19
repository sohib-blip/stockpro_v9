import {
  DEVICE_TYPE_HARDWARE_KEYS,
  dispatchItemKey,
  inventoryBaseName,
} from "./dispatch-planning";

export const MAX_DISPATCH_DIMENSION_CM = 1000;
export const MAX_KINESIS_NAMES = 25;
export const MAX_KINESIS_NAME_LENGTH = 200;

// Labels that never reach the dimension lookup: the item comes from the
// Device Type column, or the row is ignored (software licence).
const RESERVED_KEYS = new Set<string>([
  ...DEVICE_TYPE_HARDWARE_KEYS,
  "kinesisinsights",
]);

export type DispatchDimensionsValue = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type DispatchInventoryRef = {
  kind: "device" | "accessory";
  id: string;
  name: string;
  kinesisNames: string[];
};

function cleanLabel(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isBlank(value: unknown) {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function dimension(raw: unknown) {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > MAX_DISPATCH_DIMENSION_CM) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

// undefined: the fields were not sent (keep the current value);
// null: all three were emptied (no dimensions).
export function parseDispatchDimensions(value: {
  lengthCm?: unknown;
  widthCm?: unknown;
  heightCm?: unknown;
}):
  | { ok: true; dimensions: DispatchDimensionsValue | null | undefined }
  | { ok: false; error: string } {
  const raw = [value.lengthCm, value.widthCm, value.heightCm];
  if (raw.every((part) => part === undefined)) return { ok: true, dimensions: undefined };
  if (raw.every((part) => part === undefined || isBlank(part))) {
    return { ok: true, dimensions: null };
  }
  const [lengthCm, widthCm, heightCm] = raw.map(dimension);
  if (lengthCm === null || widthCm === null || heightCm === null) {
    return {
      ok: false,
      error: `Enter length, width and height between 0 and ${MAX_DISPATCH_DIMENSION_CM} cm, or leave all three empty`,
    };
  }
  return { ok: true, dimensions: { lengthCm, widthCm, heightCm } };
}

export function parseKinesisNames(
  raw: unknown
): { ok: true; names: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, names: undefined };
  if (!Array.isArray(raw)) return { ok: false, error: "Kinesis names must be a list" };

  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const name = cleanLabel(value);
    if (!name) continue;
    if (name.length > MAX_KINESIS_NAME_LENGTH) {
      return {
        ok: false,
        error: `Kinesis names must be at most ${MAX_KINESIS_NAME_LENGTH} characters`,
      };
    }
    const key = dispatchItemKey(name);
    if (!key) return { ok: false, error: `"${name}" must contain letters or numbers` };
    if (RESERVED_KEYS.has(key)) {
      return {
        ok: false,
        error: `"${name}" is identified from the Device Type column. Add the device model instead (for example FMC150).`,
      };
    }
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length > MAX_KINESIS_NAMES) {
    return { ok: false, error: `A record can have at most ${MAX_KINESIS_NAMES} Kinesis names` };
  }
  return { ok: true, names };
}

// Kinesis names and device names must each point to a single record,
// otherwise a sheet row could match two sets of dimensions.
export function findKinesisNameConflict(
  candidate: { kind: "device" | "accessory"; id?: string; kinesisNames: string[] },
  records: DispatchInventoryRef[]
) {
  const owners = new Map<string, DispatchInventoryRef>();
  for (const record of records) {
    if (record.kind === candidate.kind && record.id === candidate.id) continue;
    const strongLabels = [
      ...(record.kind === "device" ? [record.name] : []),
      ...(record.kinesisNames || []),
    ];
    for (const label of strongLabels) {
      const key = dispatchItemKey(label);
      if (key && !owners.has(key)) owners.set(key, record);
    }
  }
  for (const label of candidate.kinesisNames) {
    const owner = owners.get(dispatchItemKey(label));
    if (owner) {
      return `"${label}" is already used by ${inventoryBaseName(owner.name) || owner.name}`;
    }
  }
  return null;
}

// True when the label already resolves to this record without a Kinesis name.
export function recordAnswersToLabel(record: DispatchInventoryRef, label: string) {
  const key = dispatchItemKey(label);
  return [record.name, inventoryBaseName(record.name), ...(record.kinesisNames || [])]
    .map((value) => dispatchItemKey(value))
    .includes(key);
}
