import { describe, expect, it } from "vitest";
import {
  hasPermission,
  permissionForPage,
  permissionsForApi,
  permissionsForRole,
} from "../../lib/access-control";

describe("access control", () => {
  it("gives administrators every permission", () => {
    const permissions = permissionsForRole("admin");
    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it("keeps viewers read-only by default", () => {
    const permissions = permissionsForRole("viewer");
    expect(permissions.can_dashboard).toBe(true);
    expect(permissions.can_inventory_export).toBe(false);
    expect(permissions.can_inbound).toBe(false);
    expect(permissions.can_admin).toBe(false);
  });

  it("keeps sensitive inventory exports out of the generic dashboard policy", () => {
    expect(permissionsForApi("/api/dashboard/export", "GET")).toEqual([
      "can_inventory_export",
    ]);
    expect(
      permissionsForApi("/api/dashboard/export-count-sheet", "GET")
    ).toEqual(["can_inventory_export"]);
    expect(permissionsForApi("/api/dashboard/summary", "GET")).toEqual([
      "can_dashboard",
    ]);
  });

  it("allows custom operator permissions without granting admin", () => {
    const permissions = permissionsForRole("operator");
    permissions.can_supply = false;

    expect(permissions.can_inventory_export).toBe(true);
    expect(
      hasPermission({ role: "operator", permissions }, "can_inbound")
    ).toBe(true);
    expect(
      hasPermission({ role: "operator", permissions }, "can_supply")
    ).toBe(false);
    expect(
      hasPermission({ role: "operator", permissions }, "can_admin")
    ).toBe(false);
  });

  it("fails closed for an unknown API route", () => {
    expect(permissionsForApi("/api/new-unmapped-route", "POST")).toEqual([]);
  });

  it("keeps the access denied page reachable without a business permission", () => {
    expect(permissionForPage("/denied")).toBeNull();
  });
});
