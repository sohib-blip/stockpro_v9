import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";

type PermsPayload = {
  can_dashboard: boolean;
  can_inbound: boolean;
  can_outbound: boolean;
  can_labels: boolean;
  can_admin: boolean;
  can_stock_alerts: boolean;
};

const DEFAULT_PERMS: PermsPayload = {
  can_dashboard: true,
  can_inbound: true,
  can_outbound: true,
  can_labels: true,
  can_admin: false,
  can_stock_alerts: false,
};

function normalizePerms(p: any): PermsPayload {
  return {
    can_dashboard: !!p?.can_dashboard,
    can_inbound: !!p?.can_inbound,
    can_outbound: !!p?.can_outbound,
    can_labels: !!p?.can_labels,
    can_admin: !!p?.can_admin,
    can_stock_alerts: !!p?.can_stock_alerts,
  };
}

function mergePerms(base: PermsPayload, patch: Partial<PermsPayload>): PermsPayload {
  const out: PermsPayload = { ...base };

  (Object.keys(DEFAULT_PERMS) as (keyof PermsPayload)[]).forEach((k) => {
    const v = (patch as any)?.[k];
    if (typeof v === "boolean") out[k] = v;
  });

  return out;
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

    const { data: permRows } = await sb
      .from("user_permissions")
      .select("*")
      .in("user_id", ids);

    const map = new Map<string, any>();
    (permRows || []).forEach((r: any) => map.set(r.user_id, r));

    const out = users
      .map((usr) => {
        const p = map.get(usr.id) ?? DEFAULT_PERMS;
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
    const body = await req.json();
    const user_id = String(body.user_id ?? "").trim();
    if (!user_id) {
      return NextResponse.json({ ok: false, error: "Missing user_id" }, { status: 400 });
    }

    const patch = body.permissions || {};
    const sb = supabaseService();

    const { data: existingRow } = await sb
      .from("user_permissions")
      .select("*")
      .eq("user_id", user_id)
      .maybeSingle();

    const existingPerms = normalizePerms(existingRow ?? DEFAULT_PERMS);
    const nextPerms = mergePerms(existingPerms, patch);

    const currentlyAdmin = !!existingPerms.can_admin;
    const wantsRemoveAdmin = currentlyAdmin && nextPerms.can_admin === false;

    if (user_id === u.user.id && wantsRemoveAdmin) {
      return NextResponse.json(
        { ok: false, error: "You cannot remove your own admin permission." },
        { status: 400 }
      );
    }

    if (wantsRemoveAdmin) {
      const { count } = await sb
        .from("user_permissions")
        .select("user_id", { count: "exact", head: true })
        .eq("can_admin", true);

      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { ok: false, error: "Cannot remove admin permission from the last admin." },
          { status: 400 }
        );
      }
    }

    await sb.from("user_permissions").upsert(
      { user_id, ...nextPerms },
      { onConflict: "user_id" }
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Update failed" },
      { status: 500 }
    );
  }
}