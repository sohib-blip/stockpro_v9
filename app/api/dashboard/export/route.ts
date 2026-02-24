import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET() {
  const { data } = await supabase
    .from("items")
    .select(`
      imei,
      imported_at,
      imported_by,
      devices(device),
      boxes(id, floor)
    `);

  const rows = (data ?? []).map((i: any) => ({
    Device: i.devices?.device,
    Box_ID: i.boxes?.id,
    Floor: i.boxes?.floor,
    IMEI: i.imei,
    Imported_At: i.imported_at,
    Imported_By: i.imported_by,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Stock");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="stock_export.xlsx"',
    },
  });
}