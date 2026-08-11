import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy route cleanup", () => {
  it("removes obsolete and duplicate application pages", () => {
    for (const route of ["boxes", "devices", "movements"]) {
      expect(
        existsSync(join(process.cwd(), "app", "(app)", route, "page.tsx"))
      ).toBe(false);
    }
  });

  it("removes the obsolete movements endpoint and access rules", () => {
    expect(
      existsSync(join(process.cwd(), "app", "api", "movements", "route.ts"))
    ).toBe(false);

    const accessControl = readFileSync(
      join(process.cwd(), "lib", "access-control.ts"),
      "utf8"
    );

    for (const route of ["/boxes", "/devices", "/movements", "/api/movements"]) {
      expect(accessControl).not.toContain(route);
    }
  });
});
