import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";

type PermsPayload = {
  can_inbound: boolean;
  can_outbound: boolean;
  can_export: boolean;
  can_admin: boolean;
  can_stock_alerts: boolean;
};

function normalizePerms(p: any): PermsPayload {
  return {
    can_inbound: !!p?.can_inbound,
    can_outbound: !!p?.can_outbound,
    can_export: !!p?.can_export,
    can_admin: !!p?.can_admin,
    can_stock_alerts: !!p?.can_stock_alerts,
  };
}

export async function GET(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false, error: u.error }, { status: 401 });

  const requester = await getPermissions(u.user.id);
  if (!requester.can_admin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const sb = supabaseService();
    const { data: usersResp, error: usersErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
    if (usersErr) throw new Error(usersErr.message);

    const users = usersResp?.users ?? [];
    const ids = users.map((x) => x.id);

    const { data: permRows, error: permErr } = await sb
      .from("user_permissions")
      .select("user_id,can_inbound,can_outbound,can_export,can_admin,can_stock_alerts")
      .in("user_id", ids);

    if (permErr) throw new Error(permErr.message);

    const map = new Map<string, any>();
    (permRows || []).forEach((r: any) => map.set(r.user_id, r));

    const out = users
      .map((usr) => {
        const p = map.get(usr.id) ?? {
          can_inbound: true,
          can_outbound: true,
          can_export: false,
          can_admin: false,
          can_stock_alerts: false,
        };
        return {
          user_id: usr.id,
          email: usr.email ?? null,
          permissions: normalizePerms(p),
        };
      })
      .sort((a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")));

    return NextResponse.json({ ok: true, users: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false, error: u.error }, { status: 401 });

  const requester = await getPermissions(u.user.id);
  if (!requester.can_admin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { user_id?: string; permissions?: Partial<PermsPayload> };
    const user_id = String(body.user_id ?? "").trim();
    if (!user_id) return NextResponse.json({ ok: false, error: "Missing user_id" }, { status: 400 });

    const p = normalizePerms(body.permissions || {});

    const sb = supabaseService();
    const { error } = await sb
      .from("user_permissions")
      .upsert({ user_id, ...p }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Update failed" }, { status: 500 });
  }
}
