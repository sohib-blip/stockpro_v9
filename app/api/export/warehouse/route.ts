import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { errorMessage } from "@/lib/error-message";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

// Columns this route requests. boxes has no box_id or box_no column in the
// schema (supabase/schema/staging-schema.sql): that read fails, its error is
// ignored and the workbook comes out empty.
type ItemRow = { imei: string | null; device_id: string | null; box_id: string | null };
type DeviceRow = { device_id: string; device: string | null };
type BoxRow = {
  box_id: string;
  box_no: string;
  device_id: string;
  floor: string | null;
};
type WarehouseSheetRow = {
  Device: string;
  Box_ID: string | null;
  Box_No: string;
  Floor: string;
  IMEI: string | null;
};

async function fetchAllItems(supabase: ReturnType<typeof sb>) {

  const pageSize = 5000;
  let from = 0;
  const allRows: ItemRow[] = [];

  while (true) {

    const { data, error } = await supabase
      .from("items")
      .select("imei, device_id, box_id")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    if (!data || data.length === 0) break;

    allRows.push(...data);

    if (data.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

export async function GET() {
  try {

    const supabase = sb();

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, box_no, device_id, floor");

    // Export all matching items.
    const items = await fetchAllItems(supabase);

    const deviceMap: Record<string, string | null> = {};
    for (const d of (devices || []) as DeviceRow[]) {
      deviceMap[String(d.device_id)] = d.device;
    }

    const boxMap: Record<
      string,
      { box_no: string; floor: string; device_id: string }
    > = {};

    for (const b of (boxes || []) as BoxRow[]) {
      boxMap[String(b.box_id)] = {
        box_no: b.box_no,
        floor: b.floor || "",
        device_id: b.device_id,
      };
    }

    const rows: WarehouseSheetRow[] = [];

    for (const it of items || []) {

      const box = boxMap[String(it.box_id)];
      if (!box) continue;

      rows.push({
        Device: deviceMap[String(box.device_id)] || "",
        Box_ID: it.box_id,
        Box_No: box.box_no,
        Floor: box.floor,
        IMEI: it.imei,
      });

    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Warehouse");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          "attachment; filename=warehouse_export.xlsx",
      },
    });

  } catch (e) {

    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Export failed") },
      { status: 500 }
    );

  }
}
