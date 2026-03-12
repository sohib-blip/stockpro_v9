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

  let allRows: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {

    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("items")
      .select(`
        imei,
        boxes (
          box_code,
          floor,
          bins (
            name
          )
        )
      `)
      .eq("status", "IN")
      .range(from, to);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) break;

    allRows.push(...data);

    if (data.length < pageSize) break;

    page++;
  }

  // grouper par floor/device/box
  const boxMap: Record<string, any> = {};

  for (const r of allRows) {

    const floor = r.boxes?.floor || "";
    const device = r.boxes?.bins?.name || "";
    const box = r.boxes?.box_code || "";

    const key = `${floor}|${device}|${box}`;

    if (!boxMap[key]) {
      boxMap[key] = {
        floor,
        device,
        box_code: box,
        expected_qty: 0,
      };
    }

    boxMap[key].expected_qty++;
  }

  const rows = Object.values(boxMap).map((b: any) => ({
    floor: b.floor,
    device: b.device,
    box_code: b.box_code,
    expected_qty: b.expected_qty,
    counted_qty: "",
    difference: "",
    note: "",
  }));

  rows.sort((a: any, b: any) => {

    if (String(a.floor) !== String(b.floor))
      return String(a.floor).localeCompare(String(b.floor));

    if (a.device !== b.device)
      return a.device.localeCompare(b.device);

    return a.box_code.localeCompare(b.box_code, undefined, { numeric: true });
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  // ajouter formule difference
  rows.forEach((_, i) => {

    const rowIndex = i + 2; // Excel commence à 1 + header

    ws[`F${rowIndex}`] = {
      f: `E${rowIndex}-D${rowIndex}`
    };

  });

  // largeur colonnes
  ws["!cols"] = [
    { wch: 8 },   // floor
    { wch: 18 },  // device
    { wch: 10 },  // box
    { wch: 12 },  // expected
    { wch: 12 },  // counted
    { wch: 12 },  // difference
    { wch: 20 },  // note
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Count Sheet");

  const buffer = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=stock_count_sheet.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}