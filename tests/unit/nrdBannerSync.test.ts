import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("NRD banner synchronization", () => {
  it("refreshes the global banner immediately after task changes", () => {
    const shell = readFileSync(
      join(process.cwd(), "components", "AppShell.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "app", "(app)", "nrd", "page.tsx"),
      "utf8"
    );

    expect(shell).toContain(
      'window.addEventListener("stockpro:nrd-changed", loadUserAndNrd)'
    );
    expect(shell).toContain(
      'window.removeEventListener("stockpro:nrd-changed", loadUserAndNrd)'
    );
    expect(page.match(/notifyNrdChanged\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
