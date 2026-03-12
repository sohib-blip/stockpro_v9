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

  const deviceMap: Record<string, any[]> = {};

  for (const r of data || []) {

    const device = r.device || "Unknown";
    const floor = r.floor || "";
    const box = r.box_code || "";

    const key = `${floor}|${box}`;

    if (!deviceMap[device]) deviceMap[device] = [];

    let existing = deviceMap[device].find(x => x.key === key);

    if (!existing) {

      existing = {
        key,
        floor,
        box_code: box,
        expected_qty: 0,
      };

      deviceMap[device].push(existing);

    }

    existing.expected_qty++;

  }

  const wb = XLSX.utils.book_new();

  for (const device of Object.keys(deviceMap)) {

    const rows = deviceMap[device].map((b) => ({
      floor: b.floor,
      box_code: b.box_code,
      expected_qty: b.expected_qty,
      counted_qty: "",
      difference: "",
      note: "",
    }));

    rows.sort((a, b) => {

      if (String(a.floor) !== String(b.floor))
        return String(a.floor).localeCompare(String(b.floor));

      return a.box_code.localeCompare(b.box_code, undefined, { numeric: true });

    });

    const ws = XLSX.utils.json_to_sheet(rows);

    rows.forEach((_, i) => {

      const rowIndex = i + 2;
      ws[`E${rowIndex}`] = { f: `D${rowIndex}-C${rowIndex}` };

    });

    ws["!cols"] = [
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, device.substring(0, 31));

  }

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