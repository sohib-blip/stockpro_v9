import { createClient } from "@supabase/supabase-js";

export type Permissions = {
  can_dashboard: boolean;
  can_inbound: boolean;
  can_outbound: boolean;
  can_labels: boolean;
  can_admin: boolean;
  can_stock_alerts?: boolean;
};

export function supabaseAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

export function supabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function requireUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) return { ok: false as const, error: "Missing Bearer token" };

  const sb = supabaseAnon();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, error: "Invalid session" };
  return { ok: true as const, user: data.user, token };
}

export async function getPermissions(userId: string) {
  const sb = supabaseService();

  const { data, error } = await sb
    .from("user_permissions")
    .select("can_dashboard,can_inbound,can_outbound,can_labels,can_admin,can_stock_alerts")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      can_dashboard: true,
      can_inbound: true,
      can_outbound: true,
      can_labels: true,
      can_admin: false,
      can_stock_alerts: false,
    } satisfies Permissions;
  }

  return {
    can_dashboard: !!data.can_dashboard,
    can_inbound: !!data.can_inbound,
    can_outbound: !!data.can_outbound,
    can_labels: !!data.can_labels,
    can_admin: !!data.can_admin,
    can_stock_alerts: !!(data as any).can_stock_alerts,
  } satisfies Permissions;
}