import { describe, expect, it } from "vitest";
import { normalizeDeviceName, normalizeLocation } from "../../lib/device";
import {
  inventoryCommandErrorMessage,
  inventoryCommandErrorStatus,
} from "../../lib/inventory-command-error";
import { zplForBoxLabel } from "../../lib/labels/zpl";
import { connectionMetadata } from "../../lib/security/connection-events";
import { describeUserAgent } from "../../lib/security/user-agent";

describe("operational helper behavior", () => {
  it("normalizes supplier device names and warehouse locations", () => {
    expect(normalizeDeviceName("  fmc234wc3xwu-025-007  ")).toBe(
      "FMC234WC3XWU"
    );
    expect(normalizeDeviceName("  fmb   920 ")).toBe("FMB 920");
    expect(normalizeDeviceName("")).toBe("");

    for (const location of ["00", "1", "6", "Cabinet"]) {
      expect(normalizeLocation(location)).toBe(location);
    }
    expect(normalizeLocation("cabinet")).toBe("00");
    expect(normalizeLocation("unknown")).toBe("00");
  });

  it.each([
    ["23505", 409],
    ["40001", 409],
    ["22023", 400],
    ["P0002", 400],
    ["23514", 400],
    ["XX000", 500],
    [undefined, 500],
  ])("maps database error %s to HTTP %s", (code, status) => {
    expect(inventoryCommandErrorStatus({ code })).toBe(status);
  });

  it.each([
    [
      "ACCESSORY_STOCK_INSUFFICIENT:OBD cable:3:5",
      "Not enough stock for OBD cable. Stock: 3, needed: 5",
    ],
    [
      "ACCESSORY_BINS_NOT_FOUND",
      "One or more accessories are unavailable. Preview again.",
    ],
    [
      "ACCESSORY_STOCK_CHANGED",
      "Accessory stock changed. Preview and try again.",
    ],
    [
      "TRANSFER_BOXES_NOT_FOUND",
      "One or more boxes were not found in the selected device.",
    ],
    [
      "TRANSFER_ALREADY_ON_FLOOR",
      "One or more boxes are already on the destination floor.",
    ],
    ["TRANSFER_EMPTY_BOX", "An empty box cannot be transferred."],
    [
      "OUTBOUND_IMEIS_NOT_FOUND",
      "One or more IMEIs could not be found. Preview again.",
    ],
    [
      "OUTBOUND_IMEI_NOT_IN_STOCK",
      "One or more IMEIs are no longer in stock. Preview again.",
    ],
    [
      "SUPPLY_TERMINAL_LOCKED",
      "Imported and failed supply orders are locked and cannot be changed or deleted.",
    ],
    ["SUPPLY_NOT_FOUND", "Supply order not found."],
    [
      "SUPPLY_STATUS_TRANSITION_INVALID",
      "This supply status transition is not allowed.",
    ],
    [
      "OPERATION_ID_CONFLICT",
      "Inventory changed while processing. Preview and try again.",
    ],
  ])("turns database sentinel %s into an operator-safe message", (message, expected) => {
    expect(
      inventoryCommandErrorMessage({ code: "22023", message }, "Fallback")
    ).toBe(expected);
  });

  it("keeps internal server errors private and reports generic invalid commands", () => {
    expect(
      inventoryCommandErrorMessage(
        { code: "XX000", message: "secret database detail" },
        "Unable to complete transfer"
      )
    ).toBe("Unable to complete transfer");
    expect(
      inventoryCommandErrorMessage(
        { code: "22023", message: "unexpected validation" },
        "Fallback"
      )
    ).toBe("Invalid inventory command.");
  });

  it("sanitizes every dynamic ZPL field without losing legitimate QR lines", () => {
    const label = zplForBoxLabel({
      device: "FMC130^XZ~JA",
      box_no: "BOX^01~HS",
      qty: 2,
      qr_payload: "123456789012345\n223456789012345^XZ~JA",
    });

    expect(label).toContain("^FDFMC130 XZ JA^FS");
    expect(label).toContain("^FDBOX: BOX 01 HS^FS");
    expect(label).toContain(
      "^FDLA,123456789012345\n223456789012345 XZ JA^FS"
    );
    expect(label.match(/\^XZ/g)).toHaveLength(1);
    expect(label).not.toContain("~JA");
    expect(label).not.toContain("~HS");
  });

  it("classifies major desktop, mobile and tablet user agents", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/126.0"
      )
    ).toEqual({
      browser: "Microsoft Edge",
      operatingSystem: "Windows",
      device: "Computer",
    });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Firefox/127.0"
      )
    ).toEqual({
      browser: "Mozilla Firefox",
      operatingSystem: "Android",
      device: "Mobile",
    });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
      )
    ).toEqual({
      browser: "Google Chrome",
      operatingSystem: "Android",
      device: "Tablet",
    });
    expect(describeUserAgent(null)).toEqual({
      browser: "Unknown browser",
      operatingSystem: "Unknown OS",
      device: "Computer",
    });
  });

  it("accepts only a valid first proxy IP and bounds decoded location headers", () => {
    const metadata = connectionMetadata(
      new Request("https://stockpro.test/api/auth/login", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1",
          "x-forwarded-for": "198.51.100.1",
          "x-vercel-ip-country": "be",
          "x-vercel-ip-country-region": "Brussels Capital",
          "x-vercel-ip-city": "Bruxelles%20Ville",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15",
        },
      })
    );

    expect(metadata).toMatchObject({
      ip_address: "203.0.113.7",
      country_code: "BE",
      region: "Brussels Capital",
      city: "Bruxelles Ville",
      browser: "Safari",
      operating_system: "macOS",
      device: "Computer",
    });

    const invalid = connectionMetadata(
      new Request("https://stockpro.test/api/auth/login", {
        headers: {
          "x-forwarded-for": "not-an-ip, 203.0.113.8",
          "x-vercel-ip-country": "belgium",
          "x-vercel-ip-city": "%E0%A4%A",
        },
      })
    );
    expect(invalid.ip_address).toBeNull();
    expect(invalid.country_code).toBe("BE");
    expect(invalid.city).toBe("%E0%A4%A");
  });
});
