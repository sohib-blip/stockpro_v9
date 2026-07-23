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
import { sessionIdFromAccessToken } from "./security/app-session";

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

  const sessionId = sessionIdFromAccessToken(token);
  if (!sessionId) {
    return { ok: false as const, error: "Invalid session" };
  }

  return { ok: true as const, user: data.user, sessionId, token };
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

  const role = (roleRow?.role as AppRole | undefined) ?? null;
  const permissions = permissionRow
    ? normalizePermissions(permissionRow)
    : { ...EMPTY_PERMISSIONS };

  // Administrator authority has one canonical signal. The stored permission
  // remains a derived UI field and can never override a non-admin role.
  permissions.can_admin = role === "admin";

  return { role, permissions };
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

  const service = supabaseService();
  const { data: activeSession, error: sessionError } = await service.rpc(
    "touch_app_session",
    {
      p_user_id: session.user.id,
      p_session_id: session.sessionId,
    }
  );

  if (sessionError) {
    return {
      ok: false as const,
      status: 503,
      error: "Unable to verify application session",
    };
  }

  if (activeSession !== true) {
    return {
      ok: false as const,
      status: 401,
      error: "Session expired or replaced",
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

  const isAdmin = access.role === "admin";
  const allowed =
    isAdmin ||
    required.some(
      (permission) =>
        permission !== "can_admin" && access.permissions[permission]
    );

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

export async function activateAppSession(
  userId: string,
  sessionId: string,
  email: string
) {
  const { data, error } = await supabaseService().rpc("activate_app_session", {
    p_user_id: userId,
    p_session_id: sessionId,
    p_email: email,
  });
  if (error) throw error;
  if (data !== "activated" && data !== "conflict") {
    throw new Error("Unable to activate application session");
  }
  return data as "activated" | "conflict";
}

export async function takeOverAppSession(
  userId: string,
  sessionId: string,
  eventId: string
) {
  const { data, error } = await supabaseService().rpc(
    "take_over_app_session",
    {
      p_user_id: userId,
      p_session_id: sessionId,
      p_event_id: eventId,
    }
  );
  if (error) throw error;
  return data === true;
}

export async function endAppSession(userId: string, sessionId: string) {
  const { data, error } = await supabaseService().rpc("end_app_session", {
    p_user_id: userId,
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data === true;
}

export function authorizeCapabilityRequest(
  req: Request,
  capability: AuthorizationCapability
) {
  return authorizeApiRequest(req, permissionsForCapability(capability));
}
