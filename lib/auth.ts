import { createClient } from "@supabase/supabase-js";

export type Permissions = {
  can_dashboard: boolean;
  can_inbound: boolean;
  can_outbound: boolean;
  can_labels: boolean;
  can_devices: boolean;
  can_admin: boolean;
};

export function supabaseAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export function supabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function requireUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) return { ok: false as const };

  const sb = supabaseAnon();
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return { ok: false as const };

  return { ok: true as const, user: data.user };
}

export async function getPermissions(userId: string): Promise<Permissions> {
  const sb = supabaseService();

  const { data } = await sb
    .from("user_permissions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    return {
      can_dashboard: false,
      can_inbound: false,
      can_outbound: false,
      can_labels: false,
      can_devices: false,
      can_admin: false,
    };
  }

  return {
    can_dashboard: !!data.can_dashboard,
    can_inbound: !!data.can_inbound,
    can_outbound: !!data.can_outbound,
    can_labels: !!data.can_labels,
    can_devices: !!data.can_devices,
    can_admin: !!data.can_admin,
  };
}