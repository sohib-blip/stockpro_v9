import { NextResponse } from "next/server";
import {
  getPermissions,
  requireUserFromBearer,
  supabaseService,
  type Permissions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type Role = "admin" | "operator" | "viewer";

const ROLE_PRESETS: Record<Role, Permissions> = {
  admin: {
    can_dashboard: true,
    can_inbound: true,
    can_outbound: true,
    can_labels: true,
    can_devices: true,
    can_admin: true,
  },
  operator: {
    can_dashboard: true,
    can_inbound: true,
    can_outbound: true,
    can_labels: true,
    can_devices: true,
    can_admin: false,
  },
  viewer: {
    can_dashboard: true,
    can_inbound: false,
    can_outbound: false,
    can_labels: false,
    can_devices: false,
    can_admin: false,
  },
};

const PERMISSION_KEYS = [
  "can_dashboard",
  "can_inbound",
  "can_outbound",
  "can_labels",
  "can_devices",
  "can_admin",
] as const;

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "operator" || value === "viewer";
}

function isPermissions(value: unknown): value is Permissions {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return PERMISSION_KEYS.every((key) => typeof candidate[key] === "boolean");
}

function permissionValues(value: Permissions): Permissions {
  return {
    can_dashboard: value.can_dashboard,
    can_inbound: value.can_inbound,
    can_outbound: value.can_outbound,
    can_labels: value.can_labels,
    can_devices: value.can_devices,
    can_admin: value.can_admin,
  };
}

function invitationPermissions(role: Role, value: unknown): Permissions {
  const permissions = isPermissions(value)
    ? permissionValues(value)
    : { ...ROLE_PRESETS[role] };
  if (role === "admin") permissions.can_admin = true;
  return permissions;
}

async function callerCanAdmin(userId: string) {
  const service = supabaseService();
  const [{ data: roleRow, error: roleError }, permissions] = await Promise.all([
    service.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    getPermissions(userId),
  ]);

  if (roleError) throw new Error(roleError.message);
  return roleRow?.role === "admin" || permissions.can_admin;
}

function isExistingUserError(message: string) {
  const normalised = message.toLowerCase();
  return (
    normalised.includes("already") ||
    normalised.includes("registered") ||
    normalised.includes("exists")
  );
}

export async function POST(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    if (!(await callerCanAdmin(auth.user.id))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "A valid request body is required." },
        { status: 400 }
      );
    }

    const requestBody = body as { email?: unknown; role?: unknown; permissions?: unknown };
    const email = typeof requestBody.email === "string" ? requestBody.email.trim() : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    if (!isRole(requestBody.role)) {
      return NextResponse.json(
        { ok: false, error: "Role must be admin, operator, or viewer." },
        { status: 400 }
      );
    }

    if (requestBody.permissions !== undefined && !isPermissions(requestBody.permissions)) {
      return NextResponse.json(
        { ok: false, error: "Permissions must contain all six boolean flags." },
        { status: 400 }
      );
    }

    const service = supabaseService();
    const { data: inviteData, error: inviteError } =
      await service.auth.admin.inviteUserByEmail(email);

    if (inviteError) {
      if (isExistingUserError(inviteError.message)) {
        return NextResponse.json(
          { ok: false, error: "A user with this email already exists." },
          { status: 409 }
        );
      }

      return NextResponse.json({ ok: false, error: inviteError.message }, { status: 400 });
    }

    if (!inviteData.user) {
      throw new Error("The invitation was sent without creating a user record.");
    }

    const permissions = invitationPermissions(requestBody.role, requestBody.permissions);
    const [roleResult, permissionsResult] = await Promise.all([
      service
        .from("user_roles")
        .upsert({ user_id: inviteData.user.id, role: requestBody.role }, { onConflict: "user_id" }),
      service.from("user_permissions").upsert(
        { user_id: inviteData.user.id, ...permissions },
        { onConflict: "user_id" }
      ),
    ]);

    if (roleResult.error) throw new Error(roleResult.error.message);
    if (permissionsResult.error) throw new Error(permissionsResult.error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to send invitation" },
      { status: 500 }
    );
  }
}
