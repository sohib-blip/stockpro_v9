import {
  DEVICE_TYPE_HARDWARE_KEYS,
  REQUIRED_DISPATCH_ITEM_NAMES,
  dispatchItemKey,
} from "./dispatch-planning";

export const MAX_DISPATCH_ITEM_NAME_LENGTH = 120;
export const MAX_DISPATCH_ALIAS_LENGTH = 200;
export const MAX_DISPATCH_ALIASES = 25;
export const MAX_DISPATCH_DIMENSION_CM = 1000;

// Labels that never reach the catalog lookup: the item comes from the Device
// Type column, or the row is ignored (software licence).
const RESERVED_KEYS = new Set<string>([
  ...DEVICE_TYPE_HARDWARE_KEYS,
  "kinesisinsights",
]);

const REQUIRED_KEYS = new Set<string>(
  REQUIRED_DISPATCH_ITEM_NAMES.map((name) => dispatchItemKey(name))
);

export type DispatchCatalogItemInput = {
  name: string;
  aliases: string[];
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type DispatchCatalogRecord = {
  id: string;
  name: string;
  aliases: string[];
  active: boolean;
};

type ParseResult =
  | { ok: true; value: DispatchCatalogItemInput }
  | { ok: false; error: string };

function cleanLabel(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function reservedLabelError(label: string) {
  return `"${label}" is identified from the Device Type column. Add the device model instead (for example FMC150).`;
}

export function isRequiredDispatchItem(name: string) {
  return REQUIRED_KEYS.has(dispatchItemKey(name));
}

export function parseDispatchCatalogItemInput(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid request body is required" };
  }

  const value = body as {
    name?: unknown;
    aliases?: unknown;
    lengthCm?: unknown;
    widthCm?: unknown;
    heightCm?: unknown;
  };

  const name = cleanLabel(value.name);
  if (!name) return { ok: false, error: "Item name is required" };
  if (name.length > MAX_DISPATCH_ITEM_NAME_LENGTH) {
    return {
      ok: false,
      error: `Item name must be at most ${MAX_DISPATCH_ITEM_NAME_LENGTH} characters`,
    };
  }
  if (!dispatchItemKey(name)) {
    return { ok: false, error: "Item name must contain letters or numbers" };
  }
  if (RESERVED_KEYS.has(dispatchItemKey(name))) {
    return { ok: false, error: reservedLabelError(name) };
  }

  if (value.aliases !== undefined && !Array.isArray(value.aliases)) {
    return { ok: false, error: "Other names must be a list" };
  }
  const aliases: string[] = [];
  const seen = new Set([dispatchItemKey(name)]);
  for (const raw of (value.aliases as unknown[] | undefined) ?? []) {
    const alias = cleanLabel(raw);
    if (!alias) continue;
    if (alias.length > MAX_DISPATCH_ALIAS_LENGTH) {
      return {
        ok: false,
        error: `Other names must be at most ${MAX_DISPATCH_ALIAS_LENGTH} characters`,
      };
    }
    const key = dispatchItemKey(alias);
    if (!key) {
      return { ok: false, error: `"${alias}" must contain letters or numbers` };
    }
    if (RESERVED_KEYS.has(key)) return { ok: false, error: reservedLabelError(alias) };
    // Spellings that normalise to the same label are kept once.
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  if (aliases.length > MAX_DISPATCH_ALIASES) {
    return {
      ok: false,
      error: `An item can have at most ${MAX_DISPATCH_ALIASES} other names`,
    };
  }

  const lengthCm = dimension(value.lengthCm);
  const widthCm = dimension(value.widthCm);
  const heightCm = dimension(value.heightCm);
  if (lengthCm === null || widthCm === null || heightCm === null) {
    return {
      ok: false,
      error: `Dimensions must be numbers between 0 and ${MAX_DISPATCH_DIMENSION_CM} cm`,
    };
  }

  return { ok: true, value: { name, aliases, lengthCm, widthCm, heightCm } };
}

// Every name and other name must point to a single item, otherwise a sheet
// row could match two different sets of dimensions.
export function findDispatchCatalogConflict(
  candidate: { id?: string; name: string; aliases: string[] },
  existing: DispatchCatalogRecord[]
) {
  const owners = new Map<string, DispatchCatalogRecord>();
  for (const record of existing) {
    if (record.id === candidate.id) continue;
    for (const label of [record.name, ...(record.aliases || [])]) {
      const key = dispatchItemKey(label);
      if (key && !owners.has(key)) owners.set(key, record);
    }
  }
  for (const label of [candidate.name, ...candidate.aliases]) {
    const owner = owners.get(dispatchItemKey(label));
    if (owner) {
      return label === candidate.name
        ? `An item named "${owner.name}" already exists`
        : `"${label}" is already used by ${owner.name}`;
    }
  }
  return null;
}

// Items the dispatch logic refers to by name keep that name and stay active.
export function requiredItemChangeError(
  current: DispatchCatalogRecord,
  next: { name?: string; active?: boolean }
) {
  if (!isRequiredDispatchItem(current.name)) return null;
  if (next.name !== undefined && dispatchItemKey(next.name) !== dispatchItemKey(current.name)) {
    return `${current.name} is used by the dispatch rules and cannot be renamed`;
  }
  if (next.active === false) {
    return `${current.name} is used by the dispatch rules and cannot be deactivated`;
  }
  return null;
}
