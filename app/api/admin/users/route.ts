import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";
import { z } from "zod";

export async function GET(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const sb = supabaseService();

  // List auth users (admin API via service key)
  const { data: users, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 200 });
  if (usersErr) return NextResponse.json({ ok: false, error: usersErr.message }, { status: 500 });

  const ids = users.users.map((u) => u.id);
  const { data: up } = await sb
    .from("user_permissions")
    .select("user_id, can_inbound, can_outbound, can_export, can_admin")
    .in("user_id", ids);

  const map = new Map<string, any>();
  (up || []).forEach((r: any) => map.set(r.user_id, r));

  const rows = users.users.map((u) => {
    const p = map.get(u.id);
    return {
      user_id: u.id,
      email: u.email,
      created_at: u.created_at,
      permissions: {
        can_inbound: p ? !!p.can_inbound : true,
        can_outbound: p ? !!p.can_outbound : true,
        can_export: p ? !!p.can_export : false,
        can_admin: p ? !!p.can_admin : false,
      },
    };
  });

  return NextResponse.json({ ok: true, users: rows });
}

const PatchSchema = z.object({
  user_id: z.string().min(1),
  permissions: z.object({
    can_inbound: z.boolean(),
    can_outbound: z.boolean(),
    can_export: z.boolean(),
    can_admin: z.boolean(),
  }),
});

export async function PATCH(req: Request) {
  const auth = await requireUserFromBearer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });

  const perms = await getPermissions(auth.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });

  // Prevent locking yourself out of admin by accident
  if (parsed.data.user_id === auth.user.id && !parsed.data.permissions.can_admin) {
    return NextResponse.json({ ok: false, error: "You cannot remove your own admin permission." }, { status: 400 });
  }

  const sb = supabaseService();
  const { error } = await sb.from("user_permissions").upsert(
    {
      user_id: parsed.data.user_id,
      ...parsed.data.permissions,
    },
    { onConflict: "user_id" }
  );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
