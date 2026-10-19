export const ACCESSORY_CATEGORIES = [
  "Consumables",
  "Harness",
  "Vision",
  "Items",
] as const;

export type AccessoryCategory = (typeof ACCESSORY_CATEGORIES)[number];

export const MAX_ACCESSORY_STOCK = 1_000_000;
export const MAX_ACCESSORY_NAME_LENGTH = 120;

const UNIQUE_VIOLATION = "23505";

type AccessoryBinInput =
  | {
      ok: true;
      name: string;
      currentStock: number;
      minimumStock: number;
      category: AccessoryCategory;
    }
  | { ok: false; error: string };

function wholeNumber(raw: unknown) {
  // Empty fields keep the historical default of 0.
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return raw.trim() ? Number(raw) : 0;
  return Number.NaN;
}

function isValidQuantity(value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_ACCESSORY_STOCK;
}

export function parseAccessoryBinInput(body: unknown): AccessoryBinInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid request body is required" };
  }

  const value = body as {
    name?: unknown;
    current_stock?: unknown;
    minimum_stock?: unknown;
    category?: unknown;
  };

  const name = String(value.name ?? "").trim();
  if (!name) {
    return { ok: false, error: "Accessory name is required" };
  }
  if (name.length > MAX_ACCESSORY_NAME_LENGTH) {
    return {
      ok: false,
      error: `Accessory name must be at most ${MAX_ACCESSORY_NAME_LENGTH} characters`,
    };
  }

  const category = String(value.category ?? "Consumables");
  if (category === "Packages") {
    return { ok: false, error: "Manage packaging in Packaging Inventory" };
  }
  if (!(ACCESSORY_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: "Choose a valid accessory category" };
  }

  const currentStock = wholeNumber(value.current_stock);
  if (!isValidQuantity(currentStock)) {
    return {
      ok: false,
      error: `Stock must be a whole number between 0 and ${MAX_ACCESSORY_STOCK}`,
    };
  }

  const minimumStock = wholeNumber(value.minimum_stock);
  if (!isValidQuantity(minimumStock)) {
    return {
      ok: false,
      error: `Minimum stock must be a whole number between 0 and ${MAX_ACCESSORY_STOCK}`,
    };
  }

  return {
    ok: true,
    name,
    currentStock,
    minimumStock,
    category: category as AccessoryCategory,
  };
}

export function accessoryWriteError(error: unknown, name: string) {
  if ((error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION) {
    return {
      status: 409,
      error: `An accessory named "${name}" already exists`,
    };
  }

  return {
    status: 500,
    error: (error as { message?: string } | null)?.message || "Accessory could not be saved",
  };
}
