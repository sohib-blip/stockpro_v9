import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredSiteOrigin, siteLink } from "../../lib/site-url";

afterEach(() => vi.restoreAllMocks());

describe("site links", () => {
  it("uses the configured site address, not the request host", () => {
    expect(
      siteLink(
        "/set-password",
        "https://attacker.example/api/admin/users",
        "https://stockpro.example.com/"
      )
    ).toBe("https://stockpro.example.com/set-password");
  });

  it("keeps only the origin of the configured address", () => {
    expect(configuredSiteOrigin(" https://stockpro.example.com/app?x=1 ")).toBe(
      "https://stockpro.example.com"
    );
  });

  it("rejects missing, invalid or non-web addresses", () => {
    for (const value of [undefined, "", "   ", "stockpro", "javascript:alert(1)", "ftp://x.y"]) {
      expect(configuredSiteOrigin(value)).toBeNull();
    }
  });

  it("falls back to the request address with a single warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(siteLink("/set-password", "http://localhost:3000/api/admin/users", "")).toBe(
      "http://localhost:3000/set-password"
    );
    siteLink("/set-password", "http://localhost:3000/api/admin/users", "nope");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
