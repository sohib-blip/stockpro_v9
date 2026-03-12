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
    .from("stock_export_view")
    .select("*");

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const rows = (data || []).map((r: any) => ({
    floor: r.floor || "",
    device: r.device || "",
    box_code: r.box_code || "",
    imei: r.imei || "",
  }));

  rows.sort((a, b) => {

    if (a.device !== b.device)
      return a.device.localeCompare(b.device);

    if (a.box_code !== b.box_code)
      return a.box_code.localeCompare(b.box_code, undefined, { numeric: true });

    return a.imei.localeCompare(b.imei);

  });

  const ws = XLSX.utils.json_to_sheet(rows);

  ws["!cols"] = [
    { wch: 10 },
    { wch: 18 },
    { wch: 10 },
    { wch: 22 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock");

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=stock_export.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}