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

export async function GET(req: Request, { params }: { params: { import_id: string } }) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // security gate
    const userClient = authedClient(token);
    const { error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const import_id = params.import_id;
    if (!import_id) return NextResponse.json({ ok: false, error: "Missing import_id" }, { status: 400 });

    const r = await admin
      .from("inbound_import_log_boxes")
      .select("id, created_at, box_id, device, box_no, qty")
      .eq("import_id", import_id)
      .order("created_at", { ascending: false });

    if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 400 });

    return NextResponse.json({ ok: true, boxes: r.data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}