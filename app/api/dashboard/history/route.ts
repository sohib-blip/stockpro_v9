import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export async function GET(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

    const supabase = authedClient(token);
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 10), 500);
    const q = (url.searchParams.get("q") ?? "").trim();
    const action = (url.searchParams.get("action") ?? "").trim();
    const entity = (url.searchParams.get("entity") ?? "").trim();
    const from = (url.searchParams.get("from") ?? "").trim();
    const to = (url.searchParams.get("to") ?? "").trim();

    // Prefer audit_events (newer schema)
    let r1q = supabase
      .from("audit_events")
      .select("created_at, action, entity, entity_id, payload, created_by")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from) r1q = r1q.gte("created_at", from);
    if (to) r1q = r1q.lte("created_at", to);
    if (action) r1q = r1q.ilike("action", `%${action}%`);
    if (entity) r1q = r1q.ilike("entity", `%${entity}%`);
    if (q) r1q = r1q.or(`action.ilike.%${q}%,entity.ilike.%${q}%`);

    const r1 = await r1q;

    if (!r1.error) {
      return NextResponse.json({ ok: true, events: r1.data ?? [] });
    }

    // Fallback: audit_log (older schema)
    let r2q = supabase
      .from("audit_log")
      .select("created_at, action, entity, entity_id, payload, created_by")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (from) r2q = r2q.gte("created_at", from);
    if (to) r2q = r2q.lte("created_at", to);
    if (action) r2q = r2q.ilike("action", `%${action}%`);
    if (entity) r2q = r2q.ilike("entity", `%${entity}%`);
    if (q) r2q = r2q.or(`action.ilike.%${q}%,entity.ilike.%${q}%`);

    const r2 = await r2q;

    if (r2.error) return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, events: r2.data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
