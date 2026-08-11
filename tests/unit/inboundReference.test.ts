import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("manual inbound reference", () => {
  it("sends the shared reference to the manual confirmation endpoint", () => {
    const page = readFileSync(
      join(process.cwd(), "app", "(app)", "inbound", "page.tsx"),
      "utf8"
    );

    const manualConfirmation = page.slice(
      page.indexOf('apiFetch("/api/inbound/manual-confirm"'),
      page.indexOf("const json = await res.json()", page.indexOf('apiFetch("/api/inbound/manual-confirm"'))
    );

    expect(manualConfirmation).toContain(
      "shipment_ref: shipmentRef.trim() || null"
    );
  });
});
