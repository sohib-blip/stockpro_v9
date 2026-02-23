import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, box_no, device_id, floor");

    const { data: items } = await supabase
      .from("items")
      .select("imei, device_id, box_id");

    const deviceMap: Record<string, string> = {};
    for (const d of devices || []) {
      deviceMap[String((d as any).device_id)] = (d as any).device;
    }

    const boxMap: Record<
      string,
      { box_no: string; floor: string; device_id: string }
    > = {};

    for (const b of boxes || []) {
      boxMap[String((b as any).box_id)] = {
        box_no: (b as any).box_no,
        floor: (b as any).floor || "",
        device_id: (b as any).device_id,
      };
    }

    const rows: any[] = [];

    for (const it of items || []) {
      const box = boxMap[String((it as any).box_id)];
      if (!box) continue;

      rows.push({
        Device: deviceMap[String(box.device_id)] || "",
        Box_ID: (it as any).box_id,
        Box_No: box.box_no,
        Floor: box.floor,
        IMEI: (it as any).imei,
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
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}