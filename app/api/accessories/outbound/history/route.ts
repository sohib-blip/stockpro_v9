import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("accessory_movements")
      .select(`
        id,
        created_at,
        shipment_ref,
        comment,
        qty,
        actor,
        source,
        movement_type,
        accessory_bins (
          id,
          name
        )
      `)
      .eq("movement_type", "OUT")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = (data || []).map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      shipment_ref: row.shipment_ref,
      comment: row.comment,
      qty: row.qty,
      actor: row.actor,
      source: row.source,
      movement_type: row.movement_type,
      accessory_name: row.accessory_bins?.name || "-",
    }));

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}