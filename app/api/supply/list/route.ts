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
    const { data: supplies, error: suppliesError } = await supabase
      .from("supplies")
      .select("*")
      .order("created_at", { ascending: false });

    if (suppliesError) throw suppliesError;

    const supplyIds = (supplies || []).map((s: any) => s.id);

    let items: any[] = [];

    if (supplyIds.length > 0) {
      const { data: itemsData, error: itemsError } = await supabase
        .from("supply_items")
        .select("id, supply_id, product_id, product_type, product_name, qty")
        .in("supply_id", supplyIds)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      items = itemsData || [];
    }

    const rows = (supplies || []).map((supply: any) => ({
      ...supply,
      supply_items: items.filter((item: any) => item.supply_id === supply.id),
    }));

    return NextResponse.json({
      ok: true,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Supply list failed" },
      { status: 500 }
    );
  }
}