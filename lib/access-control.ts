import {
  capabilityForApiRequest,
  permissionsForCapability,
} from "./security/capabilities";

export const ROLE_VALUES = ["admin", "operator", "viewer"] as const;

export type AppRole = (typeof ROLE_VALUES)[number];

export const PERMISSION_KEYS = [
  "can_dashboard",
  "can_inventory_export",
  "can_inbound",
  "can_outbound",
  "can_returns",
  "can_transfer",
  "can_labels",
  "can_bins",
  "can_accessories",
  "can_supply",
  "can_nrd",
  "can_admin",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Permissions = Record<PermissionKey, boolean>;

export type AccessProfile = {
  role: AppRole | null;
  permissions: Permissions;
};

export const EMPTY_PERMISSIONS: Permissions = {
  can_dashboard: false,
  can_inventory_export: false,
  can_inbound: false,
  can_outbound: false,
  can_returns: false,
  can_transfer: false,
  can_labels: false,
  can_bins: false,
  can_accessories: false,
  can_supply: false,
  can_nrd: false,
  can_admin: false,
};

export function permissionsForRole(role: AppRole): Permissions {
  if (role === "admin") {
    return Object.fromEntries(
      PERMISSION_KEYS.map((permission) => [permission, true])
    ) as Permissions;
  }

  if (role === "operator") {
    return {
      can_dashboard: true,
      can_inventory_export: true,
      can_inbound: true,
      can_outbound: true,
      can_returns: true,
      can_transfer: true,
      can_labels: true,
      can_bins: true,
      can_accessories: true,
      can_supply: true,
      can_nrd: true,
      can_admin: false,
    };
  }

  return {
    ...EMPTY_PERMISSIONS,
    can_dashboard: true,
  };
}

export function normalizePermissions(
  value: Partial<Record<PermissionKey, unknown>> | null | undefined
): Permissions {
  return Object.fromEntries(
    PERMISSION_KEYS.map((permission) => [permission, value?.[permission] === true])
  ) as Permissions;
}

export function hasPermission(
  access: AccessProfile,
  required: PermissionKey | readonly PermissionKey[]
) {
  if (access.role === "admin" || access.permissions.can_admin) return true;

  const permissions = typeof required === "string" ? [required] : required;
  return permissions.some((permission) => access.permissions[permission]);
}

export function permissionForPage(pathname: string): PermissionKey | null {
  const rules: Array<[string, PermissionKey]> = [
    ["/admin", "can_admin"],
    ["/dashboard", "can_dashboard"],
    ["/inbound", "can_inbound"],
    ["/outbound", "can_outbound"],
    ["/returns", "can_returns"],
    ["/transfer", "can_transfer"],
    ["/labels", "can_labels"],
    ["/bins", "can_bins"],
    ["/accessories", "can_accessories"],
    ["/supply", "can_supply"],
    ["/nrd", "can_nrd"],
  ];

  return rules.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}

export function permissionsForApi(
  pathname: string,
  method: string
): readonly PermissionKey[] | null {
  // Password verification is the only public application API. Supabase Auth
  // performs the credential check and rate limiting inside the route.
  if (pathname === "/api/auth/login" && method === "POST") return null;
  if (pathname === "/api/auth/connection-event" && method === "PATCH") {
    return PERMISSION_KEYS;
  }
  if (pathname.startsWith("/api/admin")) return ["can_admin"];
  if (pathname === "/api/cron/low-stock") return null;

  const capability = capabilityForApiRequest(pathname, method);
  if (capability) return permissionsForCapability(capability);

  if (pathname.startsWith("/api/dashboard/min-stock")) {
    return ["can_bins"];
  }

  if (pathname.startsWith("/api/dashboard/bins")) {
    return [
      "can_dashboard",
      "can_inbound",
      "can_transfer",
      "can_labels",
      "can_bins",
      "can_supply",
    ];
  }

  if (pathname.startsWith("/api/dashboard")) return ["can_dashboard"];
  if (pathname.startsWith("/api/accessory-bins")) {
    if (method === "GET") {
      return ["can_dashboard", "can_accessories", "can_bins", "can_supply"];
    }
    return ["can_bins"];
  }

  if (pathname.startsWith("/api/accessories")) return ["can_accessories"];
  if (pathname.startsWith("/api/bins")) return ["can_bins"];
  if (pathname.startsWith("/api/inbound/labels")) {
    return ["can_inbound", "can_labels"];
  }
  if (pathname.startsWith("/api/inbound")) return ["can_inbound"];
  if (pathname.startsWith("/api/labels")) return ["can_labels"];
  if (pathname.startsWith("/api/outbound")) return ["can_outbound"];
  if (pathname.startsWith("/api/returns")) return ["can_returns"];
  if (pathname.startsWith("/api/transfer")) return ["can_transfer"];
  if (pathname.startsWith("/api/supply")) return ["can_supply"];
  if (pathname.startsWith("/api/nrd/export-global")) return ["can_admin"];
  if (pathname.startsWith("/api/nrd")) return ["can_nrd"];
  if (pathname.startsWith("/api/export")) return ["can_admin"];

  return [];
}
