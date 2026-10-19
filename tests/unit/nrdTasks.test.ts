import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translateUiText } from "../../lib/i18n";

const page = readFileSync(join(process.cwd(), "app/(app)/nrd/page.tsx"), "utf8");

describe("NRD tasks", () => {
  it("offers Order Preparation next to Order Checks", () => {
    expect(page).toContain('"Order Checks",\n  "Order Preparation",');
  });

  it("translates Order Preparation", () => {
    expect(translateUiText("fr", "Order Preparation")).toBe("Préparation des commandes");
    expect(translateUiText("nl", "Order Preparation")).toBe("Orders klaarmaken");
  });
});
