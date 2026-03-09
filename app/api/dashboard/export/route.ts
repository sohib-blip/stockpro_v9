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
  const { data, error } = await supabase
    .from("items")
    .select(`
      imei,
      created_at,
      imported_by,
      boxes (
        id,
        box_code,
        floor,
        bins (
          name
        )
      )
    `)
    .eq("status", "IN");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((r: any) => ({
    device: r.boxes?.bins?.name || "",
    box_id: r.boxes?.id || "",
    box_code: r.boxes?.box_code || "",
    floor: r.boxes?.floor || "",
    imei: r.imei || "",
    imported_at: r.created_at || "",
    imported_by: r.imported_by || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Current Stock");

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=current_stock.xlsx`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}