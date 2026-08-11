import { describe, expect, it } from "vitest";
import {
  MAX_MINIMUM_STOCK,
  parseMinimumStockUpdate,
} from "../../lib/minimum-stock";

const deviceId = "123e4567-e89b-42d3-a456-426614174000";

describe("minimum stock validation", () => {
  it.each([
    [0, 0],
    [25, 25],
    [MAX_MINIMUM_STOCK, MAX_MINIMUM_STOCK],
    ["0", 0],
    [" 250 ", 250],
  ])("accepts operational value %s", (value, expected) => {
    expect(
      parseMinimumStockUpdate({ device_id: deviceId, min_stock: value })
    ).toEqual({
      ok: true,
      deviceId,
      minimumStock: expected,
    });
  });

  it.each([
    undefined,
    null,
    "",
    " ",
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    MAX_MINIMUM_STOCK + 1,
    true,
    {},
    [],
  ])("rejects invalid minimum stock value %s", (value) => {
    expect(
      parseMinimumStockUpdate({ device_id: deviceId, min_stock: value })
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Minimum stock"),
    });
  });

  it.each([
    null,
    [],
    {},
    { device_id: "not-a-uuid", min_stock: 10 },
    { device_id: "", min_stock: 10 },
  ])("rejects invalid request or device value %s", (value) => {
    expect(parseMinimumStockUpdate(value)).toMatchObject({ ok: false });
  });
});
