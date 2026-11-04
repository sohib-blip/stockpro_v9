import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { loadSupplyOrdersWithItems } from "@/lib/supply-orders";
import { errorMessage } from "@/lib/supabase/read-all-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  let supplies: Awaited<ReturnType<typeof loadSupplyOrdersWithItems>>;
  try {
    supplies = await loadSupplyOrdersWithItems(supabase);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Supply export failed") },
      { status: 500 }
    );
  }

  const rows = supplies.flatMap((s): Record<string, unknown>[] => {
    const supplyItems = s.supply_items;

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
