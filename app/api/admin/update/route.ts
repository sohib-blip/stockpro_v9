import { NextResponse } from "next/server";
import {
  getPermissions,
  requireUserFromBearer,
  supabaseService,
  type Permissions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type Role = "admin" | "operator" | "viewer";

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

async function callerCanAdmin(userId: string) {
  const service = supabaseService();
  const [{ data: roleRow, error: roleError }, permissions] = await Promise.all([
    service.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    getPermissions(userId),
  ]);

  if (roleError) throw new Error(roleError.message);
  return roleRow?.role === "admin" || permissions.can_admin;
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

    const requestBody = body as {
      userId?: unknown;
      role?: unknown;
      permissions?: unknown;
    };

    if (typeof requestBody.userId !== "string" || !requestBody.userId.trim()) {
      return NextResponse.json(
        { ok: false, error: "A user ID is required." },
        { status: 400 }
      );
    }

    if (!isRole(requestBody.role)) {
      return NextResponse.json(
        { ok: false, error: "Role must be admin, operator, or viewer." },
        { status: 400 }
      );
    }

    if (!isPermissions(requestBody.permissions)) {
      return NextResponse.json(
        { ok: false, error: "Permissions must contain all six boolean flags." },
        { status: 400 }
      );
    }

    const userId = requestBody.userId.trim();
    const service = supabaseService();
    const { data: currentRole, error: currentRoleError } = await service
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (currentRoleError) throw new Error(currentRoleError.message);

    if (currentRole?.role === "admin" && requestBody.role !== "admin") {
      const { count, error: countError } = await service
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");

      if (countError) throw new Error(countError.message);
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { ok: false, error: "The last administrator cannot be demoted." },
          { status: 400 }
        );
      }
    }

    const permissions: Permissions = {
      can_dashboard: requestBody.permissions.can_dashboard,
      can_inbound: requestBody.permissions.can_inbound,
      can_outbound: requestBody.permissions.can_outbound,
      can_labels: requestBody.permissions.can_labels,
      can_devices: requestBody.permissions.can_devices,
      can_admin: requestBody.role === "admin" ? true : requestBody.permissions.can_admin,
    };

    const [roleResult, permissionsResult] = await Promise.all([
      service
        .from("user_roles")
        .upsert({ user_id: userId, role: requestBody.role }, { onConflict: "user_id" }),
      service
        .from("user_permissions")
        .upsert({ user_id: userId, ...permissions }, { onConflict: "user_id" }),
    ]);

    if (roleResult.error) throw new Error(roleResult.error.message);
    if (permissionsResult.error) throw new Error(permissionsResult.error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update user" },
      { status: 500 }
    );
  }
}
