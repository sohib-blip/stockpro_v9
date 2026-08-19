import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mergeDashboardInventoryRows } from "@/lib/dashboard-inventory-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const [
    { data: accessories, error: accessoriesError },
    { data: packaging, error: packagingError },
  ] = await Promise.all([
    supabase
      .from("accessory_bins")
      .select("id,name,category,current_stock,minimum_stock,active")
      .eq("active", true),
    supabase
      .from("packaging_types")
      .select(
        "id,code,name,length_cm,width_cm,height_cm,on_hand_stock,reserved_stock,minimum_stock,active"
      )
      .eq("active", true),
  ]);

  const error = accessoriesError || packagingError;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const rows = mergeDashboardInventoryRows(accessories || [], packaging || []);

  return NextResponse.json({
    ok: true,
    rows,
    kpis: {
      total_accessories: rows.length,
      total_qty: rows.reduce(
        (total, row) => total + row.current_stock,
        0
      ),
      low_stock: rows.filter((row) => row.status === "LOW").length,
      empty_stock: rows.filter((row) => row.status === "EMPTY").length,
    },
  });
}
