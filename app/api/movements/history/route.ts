import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url) return null;
  if (!key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchMovements(admin: any, limit: number) {
  // ✅ try the most likely PK first: movement_id
  const a = await admin
    .from("box_movements")
    .select("movement_id, box_id, from_location, to_location, note, created_by_email, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!a.error) {
    // normalize for UI that expects "id"
    const data = (a.data || []).map((m: any) => ({ ...m, id: m.movement_id }));
    return { data, error: null };
  }

  // fallback: maybe your column is actually "id"
  const msg = String(a.error?.message || "").toLowerCase();
  if (msg.includes("movement_id") && msg.includes("does not exist")) {
    const b = await admin
      .from("box_movements")
      .select("id, box_id, from_location, to_location, note, created_by_email, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!b.error) return { data: b.data || [], error: null };
    return { data: null, error: b.error };
  }

  return { data: null, error: a.error };
}

export async function GET(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Missing service role key or URL" }, { status: 500 });
    }

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || "100"), 500);

    // ✅ Fetch last moves
    const r = await fetchMovements(admin, limit);
    if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 400 });

    const rows = r.data || [];

    // ✅ Fetch related boxes (to show device + master_box_no + current location)
    const boxIds = Array.from(new Set(rows.map((x: any) => x.box_id))).filter(Boolean);

    let boxMap: Record<string, any> = {};
    if (boxIds.length) {
      const b = await admin
        .from("boxes")
        .select("box_id, device, master_box_no, box_no, location, status")
        .in("box_id", boxIds);

      if (!b.error && b.data) {
        boxMap = Object.fromEntries(b.data.map((row: any) => [row.box_id, row]));
      }
    }

    const events = rows.map((m: any) => ({
      ...m,
      box: boxMap[m.box_id] || null,
    }));

    return NextResponse.json({ ok: true, events });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
