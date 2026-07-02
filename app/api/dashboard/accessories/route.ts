import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from("accessories")
    .select(`
      id,
      name,
      current_stock,
      minimum_stock,
      active,
      accessory_bins (
        id,
        name
      )
    `)
    .eq("active", true)
    .order("name");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const rows = (data || []).map((row: any) => {
    const stock = Number(row.current_stock || 0);
    const min = Number(row.minimum_stock || 0);

    let status = "OK";

    if (stock <= 0) status = "EMPTY";
    else if (min > 0 && stock <= min) status = "LOW";

    return {
      id: row.id,
      name: row.name,
      bin: row.accessory_bins?.name || "-",
      current_stock: stock,
      minimum_stock: min,
      status,
    };
  });

  return NextResponse.json({
    ok: true,
    rows,
    kpis: {
      total_accessories: rows.length,
      total_qty: rows.reduce((a, b) => a + b.current_stock, 0),
      low_stock: rows.filter((r) => r.status === "LOW").length,
      empty_stock: rows.filter((r) => r.status === "EMPTY").length,
    },
  });
}