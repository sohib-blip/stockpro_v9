import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AppRole,
  normalizePermissions,
  permissionsForRole,
  ROLE_VALUES,
} from "@/lib/access-control";
import { authorizeApiRequest, supabaseService } from "@/lib/auth";
import {
  saveSecurityAlertRecipient,
  securityAlertRecipientIds,
} from "@/lib/security-alert-recipients";
import {
  errorMessage,
  readAllPages,
  rowsOrThrow,
} from "@/lib/supabase/read-all-pages";
import { siteLink } from "@/lib/site-url";

const roleSchema = z.enum(ROLE_VALUES);
const permissionsSchema = z.record(z.string(), z.boolean()).default({});

const updateSchema = z.object({
  user_id: z.string().uuid(),
  role: roleSchema,
  permissions: permissionsSchema,
  // IT contact for the security update alert (administrators only).
  security_alerts: z.boolean().optional(),
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

// Supabase Auth lists users one numbered page at a time. Reading stops on an
// empty page, so a server-side page size below perPage cannot drop users.
const AUTH_USERS_PER_PAGE = 1000;
const AUTH_USERS_MAX_PAGES = 100;

async function listAllAuthUsers(supabase: ReturnType<typeof supabaseService>) {
  const users: User[] = [];
  for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PER_PAGE,
    });
    if (error) throw error;
    if (data.users.length === 0) return users;
    users.push(...data.users);
  }
  throw new Error("Read stopped: too many pages");
}

// Every account with its role, permissions and IT alert flag, all pages read.
function loadUserDirectory(supabase: ReturnType<typeof supabaseService>) {
  return Promise.all([
    listAllAuthUsers(supabase),
    readAllPages((from, to) =>
      supabase
        .from("user_roles")
        .select("user_id,role")
        .order("user_id")
        .range(from, to)
        .then(rowsOrThrow)
    ),
    readAllPages((from, to) =>
      supabase
        .from("user_permissions")
        .select("*")
        .order("user_id")
        .range(from, to)
        .then(rowsOrThrow)
    ),
    securityAlertRecipientIds(supabase).catch(() => null),
  ]);
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
  let directory: Awaited<ReturnType<typeof loadUserDirectory>>;
  try {
    directory = await loadUserDirectory(supabase);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Unable to load users") },
      { status: 500 }
    );
  }
  const [users, roles, permissions, itContacts] = directory;

  const roleByUser = new Map(
    roles.map((row) => [row.user_id, row.role as AppRole])
  );
  const permissionsByUser = new Map(
    permissions.map((row) => [
      row.user_id,
      normalizePermissions(row),
    ])
  );

  return NextResponse.json({
    ok: true,
    current_user_id: admin.user.id,
    users: users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      role: roleByUser.get(user.id) ?? null,
      permissions: permissionsByUser.get(user.id) ?? null,
      security_alerts: itContacts?.has(user.id) ?? false,
    })),
    security_alerts_available: itContacts !== null,
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
    await saveSecurityAlertRecipient(
      supabaseService(),
      parsed.data.user_id,
      parsed.data.role,
      parsed.data.security_alerts,
      admin.user.email ?? null
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
    { redirectTo: siteLink("/set-password", req.url) }
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
