import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 10), 500);
    const q = (url.searchParams.get("q") ?? "").trim();
    const from = (url.searchParams.get("from") ?? "").trim();
    const to = (url.searchParams.get("to") ?? "").trim();

    const supabase = authedClient(token);
    const admin = adminClient();

    // Validate token/user (even if we use admin for reads)
    const { error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 401 });

    const reader = admin ?? supabase;

    // Treat both STOCK_OUT and MANUAL_OUT as outbound events.
    // (Older code paths used MANUAL_OUT for bulk removals.)
    const actionOr = "action.eq.STOCK_OUT,action.eq.MANUAL_OUT";

    let query = reader
      .from("audit_events")
      .select("created_at, action, entity, entity_id, payload, created_by")
      .or(actionOr)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
    if (q) query = query.or(`entity.ilike.%${q}%,entity_id.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) {
      // Fallback older schema
      let q2 = reader
        .from("audit_log")
        .select("created_at, action, entity, entity_id, payload, created_by")
        .or(actionOr)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (from) q2 = q2.gte("created_at", from);
      if (to) q2 = q2.lte("created_at", to);
      if (q) q2 = q2.or(`entity.ilike.%${q}%,entity_id.ilike.%${q}%`);
      const r2 = await q2;
      if (r2.error) return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });
      return NextResponse.json({ ok: true, events: r2.data ?? [] });
    }

    const events = (data ?? []) as any[];

    // Attach creator name (first part of email)
    const creatorIds = Array.from(new Set(events.map((e) => String(e.created_by || "")).filter(Boolean)));
    const emailByUser = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: profiles } = await reader
        .from("profiles")
        .select("user_id, email")
        .in("user_id", creatorIds);

      for (const p of profiles ?? []) {
        const id = String((p as any).user_id);
        const email = String((p as any).email || "").trim();
        if (id && email) emailByUser.set(id, email);
      }
    }

    const out = events.map((e) => {
      const id = String(e.created_by || "");
      const email = emailByUser.get(id) || "";
      const name = email ? email.split("@")[0] : "";
      return { ...e, created_by_email: email || null, created_by_name: name || null };
    });

    return NextResponse.json({ ok: true, events: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
