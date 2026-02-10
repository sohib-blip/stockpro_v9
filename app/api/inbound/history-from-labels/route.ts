import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { detectSessionInUrl: false },
  });
}

export async function GET(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // security gate: user must be logged in
    const userClient = authedClient(token);
    const { error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);

    const r = await admin
      .from("inbound_import_logs")
      .select("id, created_at, vendor, location, file_name, created_by_email, devices, boxes, items")
      .eq("vendor", "labels")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, imports: r.data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}