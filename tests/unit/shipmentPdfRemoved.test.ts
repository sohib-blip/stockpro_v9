import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The unused /api/outbound/shipment-pdf route (pdfkit) was removed: no screen
// ever called it and pdfkit could not find its fonts once bundled by Next 16.
// PDFs in StockPro are made with pdf-lib (inbound and box labels).

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [full] : [];
  });
}

describe("removed shipment PDF route", () => {
  it("no longer ships the route", () => {
    expect(
      existsSync(path.join(root, "app/api/outbound/shipment-pdf"))
    ).toBe(false);
  });

  it("does not depend on pdfkit any more", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.dependencies).not.toHaveProperty("pdfkit");
    expect(pkg.devDependencies).not.toHaveProperty("@types/pdfkit");

    const importers = ["app", "lib", "components"]
      .filter((dir) => existsSync(path.join(root, dir)))
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) => /from\s+["']pdfkit["']|require\(["']pdfkit["']\)/.test(readFileSync(file, "utf8")));
    expect(importers).toEqual([]);
  });
});
