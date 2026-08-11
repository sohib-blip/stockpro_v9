import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("direct sensitive table access", () => {
  it("keeps items and movements out of browser-side Supabase queries", () => {
    const roots = [
      join(process.cwd(), "app", "(app)"),
      join(process.cwd(), "components"),
      join(process.cwd(), "lib"),
    ];

    const violations = roots.flatMap(sourceFiles).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /\.from\(["'](items|movements)["']\)/.test(source)
        ? [relative(process.cwd(), file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
