import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../../lib/access-control";
import {
  AUTHORIZATION_CAPABILITIES,
  capabilityForApiRequest,
  permissionsForCapability,
} from "../../lib/security/capabilities";

const migrationRoot = join(process.cwd(), "supabase", "migrations");
const authorizationMigrations = [
  "20260723090000_add_sensitive_export_permission.sql",
  "20260723090100_harden_inventory_authorization.sql",
]
  .map((name) => readFileSync(join(migrationRoot, name), "utf8").toLowerCase())
  .join("\n");

describe("central authorization capability matrix", () => {
  it("declares every reviewed sensitive inventory capability", () => {
    expect(Object.keys(AUTHORIZATION_CAPABILITIES).sort()).toEqual(
      [
        "bins.manage",
        "bins.read",
        "inventory.export.raw",
        "inventory.item-match",
        "inventory.read",
        "movement.read",
      ].sort()
    );
  });

  it("uses only registered application permissions", () => {
    const knownPermissions = new Set<string>(PERMISSION_KEYS);

    for (const definition of Object.values(AUTHORIZATION_CAPABILITIES)) {
      expect(definition.dataClass.length).toBeGreaterThan(0);
      expect(definition.scope.length).toBeGreaterThan(0);
      expect(definition.projection.length).toBeGreaterThan(0);
      for (const permission of definition.permissions) {
        expect(knownPermissions.has(permission)).toBe(true);
      }
    }
  });

  it("binds both exact export routes to one dedicated capability", () => {
    expect(
      capabilityForApiRequest("/api/dashboard/export", "GET")
    ).toBe("inventory.export.raw");
    expect(
      capabilityForApiRequest("/api/dashboard/export-count-sheet", "GET")
    ).toBe("inventory.export.raw");
    expect(permissionsForCapability("inventory.export.raw")).toEqual([
      "can_inventory_export",
    ]);
  });

  it("keeps reviewed SQL adapters traceable to the central capability names", () => {
    for (const capability of Object.keys(AUTHORIZATION_CAPABILITIES)) {
      expect(authorizationMigrations).toContain(capability);
    }
  });
});
