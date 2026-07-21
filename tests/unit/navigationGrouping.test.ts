import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  join(process.cwd(), "components", "AppShell.tsx"),
  "utf8"
);

describe("grouped application navigation", () => {
  it("keeps every existing destination in one grouped navigation", () => {
    const destinations = [
      "/dashboard",
      "/supply",
      "/inbound",
      "/outbound",
      "/accessories",
      "/bins",
      "/labels",
      "/returns",
      "/transfer",
      "/nrd",
      "/admin",
    ];

    for (const destination of destinations) {
      expect(shell.match(new RegExp(`href: "${destination}"`, "g"))).toHaveLength(1);
    }
  });

  it("uses the selected horizontal navigation with contextual secondary tabs", () => {
    for (const group of [
      "Dashboard",
      "Receiving",
      "Outbound",
      "Inventory",
      "Operations",
      "NRD",
      "Admin",
    ]) {
      expect(shell).toContain(`label: "${group}"`);
    }

    expect(shell).toContain('className="primary-nav"');
    expect(shell).toContain('className="secondary-nav"');
    expect(shell).toContain("hasPermission(item.permission)");
    expect(shell).toContain("secondaryItems.map");
  });
});
