export const MAX_MINIMUM_STOCK = 1_000_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MinimumStockUpdate =
  | { ok: true; deviceId: string; minimumStock: number }
  | { ok: false; error: string };

export function parseMinimumStockUpdate(body: unknown): MinimumStockUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A valid request body is required" };
  }

  const value = body as { device_id?: unknown; min_stock?: unknown };
  const deviceId = String(value.device_id ?? "").trim();
  if (!UUID_PATTERN.test(deviceId)) {
    return { ok: false, error: "A valid device bin is required" };
  }

  const rawMinimumStock = value.min_stock;
  const minimumStock =
    typeof rawMinimumStock === "number"
      ? rawMinimumStock
      : typeof rawMinimumStock === "string" && rawMinimumStock.trim()
        ? Number(rawMinimumStock)
        : Number.NaN;

  if (
    !Number.isSafeInteger(minimumStock) ||
    minimumStock < 0 ||
    minimumStock > MAX_MINIMUM_STOCK
  ) {
    return {
      ok: false,
      error: `Minimum stock must be a whole number between 0 and ${MAX_MINIMUM_STOCK}`,
    };
  }

  return { ok: true, deviceId, minimumStock };
}
