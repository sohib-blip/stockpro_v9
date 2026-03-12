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

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);

    const limit = 50;
    const offset = (page - 1) * limit;

    // 🔹 1. get batches paginated
    const { data: batches, error: bErr } = await supabase
      .from("outbound_batches")
      .select("batch_id, created_at, actor, shipment_ref, source")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (bErr) throw bErr;

    if (!batches || batches.length === 0) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    const batchIds = batches.map((b: any) => b.batch_id);

    // 🔹 2. get movements ONLY for these batches
    const { data: movs, error: mErr } = await supabase
      .from("movements")
      .select("batch_id")
      .eq("type", "OUT")
      .in("batch_id", batchIds);

    if (mErr) throw mErr;

    // 🔹 3. count per batch
    const counts: Record<string, number> = {};

    for (const m of movs || []) {
      const id = String((m as any).batch_id || "");
      if (!id) continue;

      counts[id] = (counts[id] || 0) + 1;
    }

    // 🔹 4. build rows
    const rows = batches.map((b: any) => ({
      batch_id: b.batch_id,
      created_at: b.created_at,
      actor: b.actor || "unknown",
      shipment_ref: b.shipment_ref || "",
      source: b.source || "",
      qty: counts[String(b.batch_id)] || 0,
    }));

    return NextResponse.json({
      ok: true,
      rows,
      page,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}