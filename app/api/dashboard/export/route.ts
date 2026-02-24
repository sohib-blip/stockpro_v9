import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = sb();

    // ✅ Current stock only (IN)
    const { data: items, error } = await supabase
      .from("items")
      .select(
        `
        imei,
        status,
        imported_at,
        imported_by,
        device_id,
        box_id,
        devices ( device ),
        boxes ( id, box_code, bin_id )
      `
      )
      .eq("status", "IN");

    if (error) throw error;

    const rows = (items ?? []).map((i: any) => ({
      Device: i.devices?.device ?? "",
      Box_ID: i.boxes?.id ?? i.box_id ?? "",
      Box_Code: i.boxes?.box_code ?? "",
      IMEI: i.imei ?? "",
      Imported_At: i.imported_at ?? "",
      Imported_By: i.imported_by ?? "",
    }));

    // Sort for readability: Device -> Box_Code -> IMEI
    rows.sort((a, b) => {
      const d = String(a.Device).localeCompare(String(b.Device));
      if (d !== 0) return d;
      const bc = String(a.Box_Code).localeCompare(String(b.Box_Code));
      if (bc !== 0) return bc;
      return String(a.IMEI).localeCompare(String(b.IMEI));
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Pretty column widths
    ws["!cols"] = [
      { wch: 28 }, // Device
      { wch: 38 }, // Box_ID
      { wch: 22 }, // Box_Code
      { wch: 18 }, // IMEI
      { wch: 24 }, // Imported_At
      { wch: 28 }, // Imported_By
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Stock_IN");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stock_export_in.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Export failed" }, { status: 500 });
  }
}