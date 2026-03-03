import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

    // 1️⃣ Get inbound batches
    const { data: batches, error: bErr } = await supabase
      .from("inbound_batches")
      .select("batch_id, created_at, actor, vendor")
      .order("created_at", { ascending: false })
      .limit(200);

    if (bErr) throw bErr;

    // 2️⃣ Get aggregated stats directly from Postgres
    const { data: stats, error: sErr } = await supabase
      .rpc("get_inbound_batch_stats");

    if (sErr) throw sErr;

    const statMap: Record<
      string,
      { imeis: number; boxes: number }
    > = {};

    for (const row of stats || []) {
      statMap[String((row as any).batch_id)] = {
        imeis: Number((row as any).imeis || 0),
        boxes: Number((row as any).boxes || 0),
      };
    }

    // 3️⃣ Merge
    const rows = (batches || []).map((b: any) => {
      const data = statMap[String(b.batch_id)] || {
        imeis: 0,
        boxes: 0,
      };

      return {
        batch_id: b.batch_id,
        created_at: b.created_at,
        actor: b.actor || "unknown",
        vendor: b.vendor || "unknown",
        boxes: data.boxes,
        imeis: data.imeis,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}