import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: supplies, error: suppliesError } = await supabase
    .from("supplies")
    .select("*")
    .order("created_at", { ascending: false });

  if (suppliesError) {
    return NextResponse.json(
      { ok: false, error: suppliesError.message },
      { status: 500 }
    );
  }

  const ids = (supplies || []).map((s: any) => s.id);

  let items: any[] = [];

  if (ids.length) {
    const { data: itemData, error: itemError } = await supabase
      .from("supply_items")
      .select("*")
      .in("supply_id", ids);

    if (itemError) {
      return NextResponse.json(
        { ok: false, error: itemError.message },
        { status: 500 }
      );
    }

    items = itemData || [];
  }

  const rows = (supplies || []).flatMap((s: any) => {
    const supplyItems = items.filter((i) => i.supply_id === s.id);

    if (!supplyItems.length) {
      return [
        {
          Order: s.order_number,
          "Created by": s.created_by,
          Route: `${s.from_office} → ${s.to_office}`,
          Item: "",
          Quantity: "",
          Tracking: s.tracking_number || "",
          Status: s.status,
          Imported: s.imported ? "Yes" : "No",
          "Imported at": s.imported_date || "",
          Created: s.created_at,
        },
      ];
    }

    return supplyItems.map((i) => ({
      Order: s.order_number,
      "Created by": s.created_by,
      Route: `${s.from_office} → ${s.to_office}`,
      Item: i.product_name,
      Quantity: i.qty,
      Tracking: s.tracking_number || "",
      Status: s.status,
      Imported: s.imported ? "Yes" : "No",
      "Imported at": s.imported_date || "",
      Created: s.created_at,
    }));
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);

  XLSX.utils.book_append_sheet(wb, ws, "Supply");

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(buffer, {
  headers: {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="supply-export-${Date.now()}.xlsx"`,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  },
});
}
