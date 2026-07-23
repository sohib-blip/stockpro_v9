import type { AppRole, PermissionKey } from "../access-control";

type EnforcementSurface = "api" | "handler" | "rls" | "rpc" | "server-only";

type CapabilityRoute = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathname: string;
};

type CapabilityDefinition = {
  description: string;
  dataClass: string;
  scope: string;
  projection: readonly string[];
  roles: readonly AppRole[];
  permissions: readonly PermissionKey[];
  enforcement: readonly EnforcementSurface[];
  routes: readonly CapabilityRoute[];
};

/**
 * The reviewed authorization contract for sensitive inventory operations.
 *
 * API and handler adapters consume this manifest directly. Database migrations
 * carry matching `capability:` markers, and regression tests verify that their
 * grants, policies, and RPCs preserve this contract.
 */
export const AUTHORIZATION_CAPABILITIES = {
  "bins.read": {
    description: "Read shared device-bin configuration.",
    dataClass: "inventory configuration",
    scope: "all configured bins",
    projection: ["id", "name", "active", "min_stock"],
    roles: ["admin", "operator", "viewer"],
    permissions: [],
    enforcement: ["rls"],
    routes: [],
  },
  "bins.manage": {
    description: "Create, update, or delete shared device-bin configuration.",
    dataClass: "inventory configuration",
    scope: "all configured bins",
    projection: ["writable bin fields"],
    roles: [],
    permissions: ["can_bins"],
    enforcement: ["rls"],
    routes: [],
  },
  "inventory.item-match": {
    description: "Return only requested IMEIs that already exist.",
    dataClass: "IMEI inventory",
    scope: "1 to 200 exact requested IMEIs",
    projection: ["imei"],
    roles: [],
    permissions: ["can_inbound"],
    enforcement: ["rpc"],
    routes: [],
  },
  "inventory.read": {
    description: "Read inventory data through a purpose-specific server API.",
    dataClass: "inventory",
    scope: "endpoint-specific",
    projection: ["endpoint-specific, least-privilege fields"],
    roles: [],
    permissions: [],
    enforcement: ["server-only"],
    routes: [],
  },
  "movement.read": {
    description: "Read module-scoped movement history through server APIs.",
    dataClass: "warehouse movements",
    scope: "authorized module or dashboard aggregate",
    projection: ["endpoint-specific movement fields"],
    roles: [],
    permissions: [
      "can_dashboard",
      "can_inbound",
      "can_outbound",
      "can_returns",
      "can_transfer",
    ],
    enforcement: ["server-only"],
    routes: [],
  },
  "inventory.export.raw": {
    description: "Export global IMEI inventory and warehouse locations.",
    dataClass: "raw inventory identifiers",
    scope: "global",
    projection: ["item_id", "floor", "device", "box_code", "imei"],
    roles: [],
    permissions: ["can_inventory_export"],
    enforcement: ["api", "handler"],
    routes: [
      { method: "GET", pathname: "/api/dashboard/export" },
      { method: "GET", pathname: "/api/dashboard/export-count-sheet" },
    ],
  },
} as const satisfies Record<string, CapabilityDefinition>;

export type AuthorizationCapability = keyof typeof AUTHORIZATION_CAPABILITIES;

export function permissionsForCapability(
  capability: AuthorizationCapability
): readonly PermissionKey[] {
  return AUTHORIZATION_CAPABILITIES[capability]
    .permissions as readonly PermissionKey[];
}

export function capabilityForApiRequest(
  pathname: string,
  method: string
): AuthorizationCapability | null {
  const normalizedMethod = method.toUpperCase();

  for (const [capability, definition] of Object.entries(
    AUTHORIZATION_CAPABILITIES
  ) as Array<[AuthorizationCapability, CapabilityDefinition]>) {
    if (
      definition.routes.some(
        (route) =>
          route.pathname === pathname && route.method === normalizedMethod
      )
    ) {
      return capability;
    }
  }

  return null;
}
