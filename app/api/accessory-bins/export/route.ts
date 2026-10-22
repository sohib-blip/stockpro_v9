import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  buildAccessoryExportSheets,
  buildAccessoryExportWorkbook,
} from "@/lib/accessory-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const [
      { data: accessories, error: accessoriesError },
      { data: packaging, error: packagingError },
    ] = await Promise.all([
      supabase
        .from("accessory_bins")
        .select("name, category, current_stock, minimum_stock, active")
        .or("category.is.null,category.neq.Packages")
        .order("name"),
      supabase
        .from("packaging_types")
        .select(
          "code, name, category, length_cm, width_cm, height_cm, on_hand_stock, reserved_stock, minimum_stock, active"
        )
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (accessoriesError) throw accessoriesError;
    if (packagingError) throw packagingError;

    const workbook = buildAccessoryExportWorkbook(
      buildAccessoryExportSheets(accessories || [], packaging || [])
    );

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="accessories-stock.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export accessories failed" },
      { status: 500 }
    );
  }
}
