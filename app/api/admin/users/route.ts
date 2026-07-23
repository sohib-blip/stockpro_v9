import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AppRole,
  normalizePermissions,
  permissionsForRole,
  ROLE_VALUES,
} from "@/lib/access-control";
import { authorizeApiRequest, supabaseService } from "@/lib/auth";

const roleSchema = z.enum(ROLE_VALUES);
const permissionsSchema = z.record(z.boolean()).default({});

const updateSchema = z.object({
  user_id: z.string().uuid(),
  role: roleSchema,
  permissions: permissionsSchema,
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: roleSchema,
  permissions: permissionsSchema,
});

async function requireAdmin(req: Request) {
  return authorizeApiRequest(req, ["can_admin"]);
}

async function saveAccess(
  userId: string,
  role: AppRole,
  rawPermissions: Record<string, boolean>
) {
  const supabase = supabaseService();
  const permissions =
    role === "admin"
      ? permissionsForRole("admin")
      : normalizePermissions(rawPermissions);
  permissions.can_admin = role === "admin";

  const { data, error } = await supabase.rpc("save_user_access", {
    p_user_id: userId,
    p_role: role,
    p_permissions: permissions,
  });
  if (error) throw error;

  return normalizePermissions(data);
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const supabase = supabaseService();
  const [{ data: authData, error: authError }, roles, permissions] =
    await Promise.all([
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      supabase.from("user_roles").select("user_id,role"),
      supabase.from("user_permissions").select("*"),
    ]);

  if (authError || roles.error || permissions.error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          authError?.message || roles.error?.message || permissions.error?.message,
      },
      { status: 500 }
    );
  }

  const roleByUser = new Map(
    (roles.data ?? []).map((row) => [row.user_id, row.role as AppRole])
  );
  const permissionsByUser = new Map(
    (permissions.data ?? []).map((row) => [
      row.user_id,
      normalizePermissions(row),
    ])
  );

  return NextResponse.json({
    ok: true,
    current_user_id: admin.user.id,
    users: authData.users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      role: roleByUser.get(user.id) ?? null,
      permissions: permissionsByUser.get(user.id) ?? null,
    })),
  });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid role or permissions" },
      { status: 400 }
    );
  }

  try {
    const permissions = await saveAccess(
      parsed.data.user_id,
      parsed.data.role,
      parsed.data.permissions
    );
    return NextResponse.json({
      ok: true,
      role: parsed.data.role,
      permissions,
    });
  } catch (error: any) {
    const message = error?.message || "Unable to save access";
    return NextResponse.json(
      { ok: false, error: message },
      {
        status:
          message === "The last administrator cannot be removed" ? 409 : 500,
      }
    );
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    return NextResponse.json(
      { ok: false, error: admin.error },
      { status: admin.status }
    );
  }

  const parsed = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "A valid email, role and permissions are required" },
      { status: 400 }
    );
  }

  const supabase = supabaseService();
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(
    parsed.data.email.trim().toLowerCase(),
    { redirectTo: new URL("/set-password", req.url).toString() }
  );

  if (error || !data.user) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Unable to invite user" },
      { status: 400 }
    );
  }

  try {
    const permissions = await saveAccess(
      data.user.id,
      parsed.data.role,
      parsed.data.permissions
    );
    return NextResponse.json(
      { ok: true, user_id: data.user.id, permissions },
      { status: 201 }
    );
  } catch (saveError: any) {
    return NextResponse.json(
      {
        ok: false,
        error: saveError?.message || "User invited but access could not be saved",
      },
      { status: 500 }
    );
  }
}
