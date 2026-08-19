import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mergeDashboardBinRows } from "@/lib/dashboard-bin-rows";
import {
  buildDashboardStockAlerts,
  mergeDashboardInventoryRows,
} from "@/lib/dashboard-inventory-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const [
    { count: totalImei, error: itemsError },
    { data: activeBins, error: binsError },
    { data: stockRows, error: stockError },
    { data: accessories, error: accessoriesError },
    { data: packaging, error: packagingError },
  ] = await Promise.all([
    supabase.from("items").select("*", { count: "exact", head: true }).eq("status", "IN"),
    supabase.from("bins").select("id,name,min_stock").eq("active", true),
    supabase.from("dashboard_bins_view").select("*"),
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

  const error =
    itemsError ||
    binsError ||
    stockError ||
    accessoriesError ||
    packagingError;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const binsRows = mergeDashboardBinRows(activeBins ?? [], stockRows ?? []);
  const inventoryRows = mergeDashboardInventoryRows(
    accessories ?? [],
    packaging ?? []
  );
  const stockAlerts = buildDashboardStockAlerts(binsRows, inventoryRows);
  const totalBoxes =
    binsRows.reduce((sum, row) => sum + row.boxes_count, 0);

  return NextResponse.json({
    ok: true,
    kpis: {
      total_bins: binsRows.length,
      total_boxes: totalBoxes,
      total_imei: totalImei ?? 0,
      alerts: stockAlerts.length,
    },
  });
}
