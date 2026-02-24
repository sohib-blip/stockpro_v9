import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";

export async function GET(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false }, { status: 401 });

  const perms = await getPermissions(u.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false }, { status: 403 });

  const sb = supabaseService();

  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });

  const { data: permRows } = await sb.from("user_permissions").select("*");

  const map = new Map(permRows?.map((p: any) => [p.user_id, p]) || []);

  const out =
    users?.users.map((u) => ({
      user_id: u.id,
      email: u.email,
      permissions: map.get(u.id) || {},
    })) || [];

  return NextResponse.json({ ok: true, users: out });
}

export async function PATCH(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false }, { status: 401 });

  const perms = await getPermissions(u.user.id);
  if (!perms.can_admin) return NextResponse.json({ ok: false }, { status: 403 });

  const { user_id, permissions } = await req.json();

  const sb = supabaseService();

  await sb
    .from("user_permissions")
    .upsert({ user_id, ...permissions }, { onConflict: "user_id" });

  return NextResponse.json({ ok: true });
}