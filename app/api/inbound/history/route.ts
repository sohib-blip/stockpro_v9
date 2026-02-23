import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = sb();

    const { data: batches, error: bErr } = await supabase
      .from("inbound_batches")
      .select("batch_id, created_at, actor, vendor, source")
      .order("created_at", { ascending: false })
      .limit(200);

    if (bErr) throw bErr;

    const { data: movs, error: mErr } = await supabase
      .from("movements")
      .select("batch_id")
      .eq("type", "IN");

    if (mErr) throw mErr;

    const counts: Record<string, number> = {};
    for (const m of movs || []) {
      const id = String((m as any).batch_id || "");
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
    }

    const rows = (batches || []).map((b: any) => ({
      batch_id: b.batch_id,
      created_at: b.created_at,
      actor: b.actor || "unknown",
      vendor: b.vendor || "unknown",
      source: b.source || "",
      qty: counts[String(b.batch_id)] || 0,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound history failed" },
      { status: 500 }
    );
  }
}