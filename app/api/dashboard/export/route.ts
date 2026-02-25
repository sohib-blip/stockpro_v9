import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const { data, error } = await supabase
      .from("items")
      .select(`
        imei,
        status,
        boxes (
          id,
          box_code,
          floor,
          bins (
            id,
            name
          )
        )
      `);

    if (error) throw error;

    const rows = (data || []).map((r: any) => ({
      bin_id: r.boxes?.bins?.id || "",
      bin_name: r.boxes?.bins?.name || "",
      box_id: r.boxes?.id || "",
      box_code: r.boxes?.box_code || "",
      floor: r.boxes?.floor || "",
      imei: r.imei,
      status: r.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dashboard Stock");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Disposition": "attachment; filename=dashboard-stock.xlsx",
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}