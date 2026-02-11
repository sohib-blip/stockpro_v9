// app/api/outbound/history/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
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

    const supabase = authedClient(token);
    const { error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const admin = adminClient();
    const reader = admin ?? supabase;

    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 10), 200);

    // STOCK_OUT only
    let q1 = reader
      .from("audit_events")
      .select("created_at, action, entity, entity_id, payload, created_by")
      .eq("action", "STOCK_OUT")
      .order("created_at", { ascending: false })
      .limit(limit);

    const r1 = await q1;
    if (!r1.error) return NextResponse.json({ ok: true, events: r1.data ?? [] });

    // fallback old table
    let q2 = reader
      .from("audit_log")
      .select("created_at, action, entity, entity_id, payload, created_by")
      .eq("action", "STOCK_OUT")
      .order("created_at", { ascending: false })
      .limit(limit);

    const r2 = await q2;
    if (r2.error) return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });

    return NextResponse.json({ ok: true, events: r2.data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}