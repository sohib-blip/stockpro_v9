import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("professional English interface", () => {
  it("uses consistent operational terminology in the main navigation", () => {
    const shell = read("components", "AppShell.tsx");

    for (const label of [
      "Supply Orders",
      "Inbound Processing",
      "Device Outbound",
      "Accessory Outbound",
      "Inventory Setup",
      "Label Printing",
      "Customer Returns",
      "Stock Transfers",
      "NRD Tracking",
      "User Access",
      "Sign out",
    ]) {
      expect(shell).toContain(label);
    }

    expect(shell).not.toContain("Environnement de test");
    expect(shell).not.toContain("<span>Logout</span>");
  });

  it("does not leave French interface copy in authentication or administration", () => {
    const copy = [
      read("app", "(auth)", "set-password", "page.tsx"),
      read("app", "(app)", "admin", "page.tsx"),
    ].join("\n");

    expect(copy).not.toMatch(/[àâçéèêëîïôûùüÿœ]/i);
    expect(copy).not.toMatch(
      /administrateur|opérateur|utilisateur|invitation envoyée|chargement|mot de passe/i
    );
  });
});
