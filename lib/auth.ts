import { createClient } from "@supabase/supabase-js";

export type Permissions = {
  can_inbound: boolean;
  can_outbound: boolean;
  can_export: boolean;
  can_admin: boolean;
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
    .select("can_inbound,can_outbound,can_export,can_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    // Default: allow basic usage, block admin/export unless explicitly granted
    return {
      can_inbound: true,
      can_outbound: true,
      can_export: false,
      can_admin: false,
    } satisfies Permissions;
  }

  return {
    can_inbound: !!data.can_inbound,
    can_outbound: !!data.can_outbound,
    can_export: !!data.can_export,
    can_admin: !!data.can_admin,
  } satisfies Permissions;
}
