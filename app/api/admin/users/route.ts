import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import {
  getPermissions,
  requireUserFromBearer,
  supabaseService,
  type Permissions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type Role = "admin" | "operator" | "viewer";

type RoleRow = {
  user_id: string;
  role: string | null;
};

type PermissionRow = Permissions & {
  user_id: string;
};

const EMPTY_PERMISSIONS: Permissions = {
  can_dashboard: false,
  can_inbound: false,
  can_outbound: false,
  can_labels: false,
  can_devices: false,
  can_admin: false,
};

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "operator" || value === "viewer";
}

function permissionValues(row?: PermissionRow): Permissions {
  if (!row) return { ...EMPTY_PERMISSIONS };

  return {
    can_dashboard: !!row.can_dashboard,
    can_inbound: !!row.can_inbound,
    can_outbound: !!row.can_outbound,
    can_labels: !!row.can_labels,
    can_devices: !!row.can_devices,
    can_admin: !!row.can_admin,
  };
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

async function listAllAuthUsers(): Promise<User[]> {
  const service = supabaseService();
  const users: User[] = [];
  const perPage = 200;

  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    users.push(...data.users);
    if (data.users.length < perPage) break;
  }

  return users;
}

export async function GET(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  }

  try {
    if (!(await callerCanAdmin(auth.user.id))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const authUsers = await listAllAuthUsers();
    const service = supabaseService();
    const roleByUserId = new Map<string, Role>();
    const permissionsByUserId = new Map<string, Permissions>();
    const chunkSize = 200;

    for (let index = 0; index < authUsers.length; index += chunkSize) {
      const userIds = authUsers.slice(index, index + chunkSize).map((user) => user.id);
      const [rolesResult, permissionsResult] = await Promise.all([
        service.from("user_roles").select("user_id, role").in("user_id", userIds),
        service
          .from("user_permissions")
          .select(
            "user_id, can_dashboard, can_inbound, can_outbound, can_labels, can_devices, can_admin"
          )
          .in("user_id", userIds),
      ]);

      if (rolesResult.error) throw new Error(rolesResult.error.message);
      if (permissionsResult.error) throw new Error(permissionsResult.error.message);

      for (const row of (rolesResult.data ?? []) as RoleRow[]) {
        if (isRole(row.role)) roleByUserId.set(row.user_id, row.role);
      }

      for (const row of (permissionsResult.data ?? []) as PermissionRow[]) {
        permissionsByUserId.set(row.user_id, permissionValues(row));
      }
    }

    return NextResponse.json({
      ok: true,
      users: authUsers.map((user) => {
        const role = roleByUserId.get(user.id) ?? "operator";
        const permissions = permissionsByUserId.get(user.id) ?? { ...EMPTY_PERMISSIONS };
        if (role === "admin") permissions.can_admin = true;

        return {
          id: user.id,
          email: user.email ?? "",
          last_sign_in_at: user.last_sign_in_at ?? null,
          role,
          permissions,
        };
      }),
      currentUserId: auth.user.id,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load users" },
      { status: 500 }
    );
  }
}
