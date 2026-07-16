import { describe, expect, it } from "vitest";

import {
  areLowStockEmailsEnabled,
  isCronRequestAuthorized,
} from "../../lib/cron/lowStockPolicy";

describe("isCronRequestAuthorized", () => {
  it("requires the exact bearer token when a cron secret is configured", () => {
    expect(isCronRequestAuthorized("Bearer test-secret", "test-secret")).toBe(true);
    expect(isCronRequestAuthorized("Bearer wrong-secret", "test-secret")).toBe(false);
    expect(isCronRequestAuthorized(null, "test-secret")).toBe(false);
  });

  it("keeps the endpoint available when no cron secret is configured", () => {
    expect(isCronRequestAuthorized(null, undefined)).toBe(true);
  });
});

describe("areLowStockEmailsEnabled", () => {
  it("disables emails when the flag is explicitly false, including production", () => {
    expect(areLowStockEmailsEnabled("false", "production")).toBe(false);
  });

  it("enables emails only when the explicit flag is true", () => {
    expect(areLowStockEmailsEnabled("true", "preview")).toBe(true);
    expect(areLowStockEmailsEnabled("TRUE", "production")).toBe(false);
  });

  it("defaults to enabled only in Vercel production", () => {
    expect(areLowStockEmailsEnabled(undefined, "production")).toBe(true);
    expect(areLowStockEmailsEnabled(undefined, "preview")).toBe(false);
    expect(areLowStockEmailsEnabled(undefined, undefined)).toBe(false);
  });
});
