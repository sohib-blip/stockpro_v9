import { describe, expect, it } from "vitest";

import {
  canonicalize,
  isImei,
  makeOk,
  resolveDeviceDisplay,
  toDeviceMatchList,
} from "../../lib/inbound/vendorParser";

describe("vendorParser", () => {
  it("normalizes device names and validates IMEIs", () => {
    expect(canonicalize(" FMC-003 ")).toBe("FMC003");
    expect(isImei("123 456 789 012 345")).toBe("123456789012345");
    expect(isImei("12345678901234")).toBeNull();
  });

  it("matches exact, padded and active device names", () => {
    const devices = toDeviceMatchList([
      { canonical_name: "FMC003", device: "FMC 003", active: true },
      { canonical_name: "FMC920", device: "FMC 920", active: false },
    ]);

    expect(resolveDeviceDisplay("FMC-003", devices)).toBe("FMC 003");
    expect(resolveDeviceDisplay("FMC03", devices)).toBe("FMC 003");
    expect(resolveDeviceDisplay("FMC920", devices)).toBeNull();
  });

  it("deduplicates IMEIs and computes label totals", () => {
    const result = makeOk([
      {
        vendor: "teltonika",
        device: "FMC 003",
        box_no: "BOX-1",
        qty: 0,
        imeis: ["123456789012345", "123456789012345", "543210987654321"],
        qr_data: "",
      },
    ], {});

    expect(result.labels[0].imeis).toEqual([
      "123456789012345",
      "543210987654321",
    ]);
    expect(result.labels[0].qr_data).toBe(
      "123456789012345\n543210987654321"
    );
    expect(result.counts).toEqual({ devices: 1, boxes: 1, items: 2 });
  });
});
