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
  try {
    const { data: items } = await supabase
      .from("items")
      .select(`
        imei,
        status,
        imported_at,
        imported_by,
        bins(name),
        boxes(box_code)
      `);

    const rows = (items ?? []).map((i: any) => ({
      Device: i.bins?.name ?? "",
      Box: i.boxes?.box_code ?? "",
      IMEI: i.imei,
      Status: i.status,
      Imported_At: i.imported_at,
      Imported_By: i.imported_by
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Stock");

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx"
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="stock_export.xlsx"'
      }
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}