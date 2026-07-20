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

  it("uses accessible accordion groups and filters every child by permission", () => {
    for (const group of [
      "Receiving",
      "Outbound",
      "Inventory",
      "Operations",
      "Productivity",
      "Administration",
    ]) {
      expect(shell).toContain(`label: "${group}"`);
    }

    expect(shell).toContain("aria-expanded={isOpen}");
    expect(shell).toContain("hasPermission(item.permission)");
    expect(shell).toContain("setOpenGroupId(activeGroupId)");
  });
});
