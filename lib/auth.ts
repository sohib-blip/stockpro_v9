import { createClient } from "@supabase/supabase-js";
import {
  AccessProfile,
  AppRole,
  EMPTY_PERMISSIONS,
  normalizePermissions,
  PermissionKey,
} from "./access-control";
import {
  AuthorizationCapability,
  permissionsForCapability,
} from "./security/capabilities";

export function supabaseAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export function supabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function requireUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token) {
    return { ok: false as const, error: "Missing token" };
  }

  const sb = supabaseAnon();
  const { data, error } = await sb.auth.getUser(token);

  if (error || !data.user) {
    return { ok: false as const, error: "Invalid session" };
  }

  return { ok: true as const, user: data.user };
}

export async function getAccessProfile(userId: string): Promise<AccessProfile> {
  const sb = supabaseService();

  const [{ data: roleRow, error: roleError }, { data: permissionRow, error: permissionError }] =
    await Promise.all([
      sb.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      sb.from("user_permissions").select("*").eq("user_id", userId).maybeSingle(),
    ]);

  if (roleError || permissionError) {
    throw roleError || permissionError;
  }

  return {
    role: (roleRow?.role as AppRole | undefined) ?? null,
    permissions: permissionRow
      ? normalizePermissions(permissionRow)
      : { ...EMPTY_PERMISSIONS },
  };
}

export async function getPermissions(userId: string) {
  return (await getAccessProfile(userId)).permissions;
}

export async function authorizeApiRequest(
  req: Request,
  required: readonly PermissionKey[]
) {
  const session = await requireUserFromBearer(req);

  if (!session.ok) {
    return {
      ok: false as const,
      status: 401,
      error: "Authentication required",
    };
  }

  let access: AccessProfile;
  try {
    access = await getAccessProfile(session.user.id);
  } catch {
    return {
      ok: false as const,
      status: 503,
      error: "Unable to verify permissions",
    };
  }

  const isAdmin = access.role === "admin" || access.permissions.can_admin;
  const allowed =
    isAdmin || required.some((permission) => access.permissions[permission]);

  if (!allowed) {
    return {
      ok: false as const,
      status: 403,
      error: access.role ? "Insufficient permissions" : "No role assigned",
    };
  }

  return {
    ok: true as const,
    user: session.user,
    access,
  };
}

export function authorizeCapabilityRequest(
  req: Request,
  capability: AuthorizationCapability
) {
  return authorizeApiRequest(req, permissionsForCapability(capability));
}
