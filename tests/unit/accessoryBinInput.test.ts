import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessoryWriteError,
  MAX_ACCESSORY_STOCK,
  parseAccessoryBinInput,
} from "../../lib/accessory-bin-input";
import { translateUiText } from "../../lib/i18n";

describe("accessory bin input", () => {
  it("accepts a valid accessory and trims its name", () => {
    expect(
      parseAccessoryBinInput({
        name: "  Power Cable ",
        current_stock: "120",
        minimum_stock: 20,
        category: "Harness",
      })
    ).toEqual({
      ok: true,
      name: "Power Cable",
      currentStock: 120,
      minimumStock: 20,
      category: "Harness",
    });
  });

  it("keeps empty quantities at zero and defaults the category", () => {
    expect(parseAccessoryBinInput({ name: "Cable Ties", current_stock: "" })).toEqual({
      ok: true,
      name: "Cable Ties",
      currentStock: 0,
      minimumStock: 0,
      category: "Consumables",
    });
  });

  it.each([
    [-5, "Stock must be a whole number between 0 and 1000000"],
    [1.5, "Stock must be a whole number between 0 and 1000000"],
    ["abc", "Stock must be a whole number between 0 and 1000000"],
    [MAX_ACCESSORY_STOCK + 1, "Stock must be a whole number between 0 and 1000000"],
  ])("rejects stock %s", (currentStock, error) => {
    expect(
      parseAccessoryBinInput({ name: "Antenna", current_stock: currentStock })
    ).toEqual({ ok: false, error });
  });

  it("rejects a negative minimum stock", () => {
    expect(
      parseAccessoryBinInput({ name: "Antenna", minimum_stock: -1 })
    ).toEqual({
      ok: false,
      error: "Minimum stock must be a whole number between 0 and 1000000",
    });
  });

  it("rejects missing names, packaging and unknown categories", () => {
    expect(parseAccessoryBinInput({})).toEqual({
      ok: false,
      error: "Accessory name is required",
    });
    expect(parseAccessoryBinInput(null)).toEqual({
      ok: false,
      error: "A valid request body is required",
    });
    expect(
      parseAccessoryBinInput({ name: "Box", category: "Packages" })
    ).toEqual({ ok: false, error: "Manage packaging in Packaging Inventory" });
    expect(
      parseAccessoryBinInput({ name: "Box", category: "Anything" })
    ).toEqual({ ok: false, error: "Choose a valid accessory category" });
    expect(parseAccessoryBinInput({ name: "x".repeat(121) })).toEqual({
      ok: false,
      error: "Accessory name must be at most 120 characters",
    });
  });

  it("explains duplicate names instead of returning the database error", () => {
    expect(
      accessoryWriteError(
        {
          code: "23505",
          message: 'duplicate key value violates unique constraint "accessory_bins_name_key"',
        },
        "Power Cable"
      )
    ).toEqual({
      status: 409,
      error: 'An accessory named "Power Cable" already exists',
    });
    expect(accessoryWriteError({ message: "boom" }, "Power Cable")).toEqual({
      status: 500,
      error: "boom",
    });
  });

  it("translates the new accessory messages", () => {
    expect(
      translateUiText("fr", 'An accessory named "Power Cable" already exists')
    ).toBe("Un accessoire nommé « Power Cable » existe déjà");
    expect(
      translateUiText("nl", "Stock must be a whole number between 0 and 1000000")
    ).toBe("De voorraad moet een geheel getal tussen 0 en 1000000 zijn");
    expect(translateUiText("fr", "2 rules")).toBe("2 règle(s)");
    expect(translateUiText("nl", "1 rule")).toBe("1 regel(s)");
  });

  it("uses the report file name when no shipment reference is typed", () => {
    const route = readFileSync(
      join(process.cwd(), "app/api/accessories/outbound/excel/route.ts"),
      "utf8"
    );

    expect(route).toContain("const historyReference = shipmentRef.trim() || fileName;");
    expect(route).toContain("p_shipment_ref: historyReference || null");
  });
});
