import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const filter = searchParams.get("filter") || "all";

    let query = supabase
      .from("transfer_batches")
      .select(`
        batch_id,
        created_at,
        actor,
        movements (
          item_id
        )
      `)
      .order("created_at", { ascending: false });

    if (filter === "today") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      query = query.gte("created_at", today.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []).map((b: any) => ({
      batch_id: b.batch_id,
      created_at: b.created_at,
      actor: b.actor,
      qty: b.movements?.length || 0,
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "History failed",
    });
  }
}