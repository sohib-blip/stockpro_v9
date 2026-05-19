import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function safeSheetName(name: string) {
  return String(name || "Unknown")
    .replace(/[\\/?*[\]:]/g, "-")
    .substring(0, 31);
}

export async function GET() {
  let allRows: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("stock_export_view")
      .select("*")
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

  const deviceMap: Record<string, number> = {};

  for (const r of allRows) {
    const device = r.device || "Unknown";
    deviceMap[device] = (deviceMap[device] || 0) + 1;
  }

  const devices = Object.keys(deviceMap).sort();

  const wb = new ExcelJS.Workbook();
  wb.creator = "StockPro";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");

  summary.columns = [
    { header: "Device", key: "device", width: 30 },
    { header: "Expected", key: "expected", width: 14 },
    { header: "Scanned", key: "scanned", width: 14 },
    { header: "Variance", key: "variance", width: 14 },
    { header: "Status", key: "status", width: 16 },
  ];

  summary.getRow(1).font = { bold: true };
  summary.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  devices.forEach((device, index) => {
    const rowNumber = index + 2;
    const sheetName = safeSheetName(device);
    const row = summary.getRow(rowNumber);

    row.getCell(1).value = device;
    row.getCell(2).value = deviceMap[device];

    row.getCell(3).value = {
      formula: `COUNTA('${sheetName}'!A2:A5000)`,
    };

    row.getCell(4).value = {
      formula: `C${rowNumber}-B${rowNumber}`,
    };

    row.getCell(5).value = {
      formula: `IF(D${rowNumber}=0,"OK",IF(D${rowNumber}<0,"MISSING","EXTRA"))`,
    };

    row.commit();
  });

  (summary as any).addConditionalFormatting({
  ref: `D2:E${devices.length + 1}`,
  rules: [
    {
      type: "expression",
      formulae: ["$D2=0"],
      style: {
        fill: {
          type: "pattern",
          pattern: "solid",
          bgColor: { argb: "FFC6EFCE" },
        },
        font: {
          color: { argb: "FF006100" },
          bold: true,
        },
      },
    },
    {
      type: "expression",
      formulae: ["$D2<>0"],
      style: {
        fill: {
          type: "pattern",
          pattern: "solid",
          bgColor: { argb: "FFFFC7CE" },
        },
        font: {
          color: { argb: "FF9C0006" },
          bold: true,
        },
      },
    },
  ],
});
  summary.views = [{ state: "frozen", ySplit: 1 }];

  for (const device of devices) {
    const ws = wb.addWorksheet(safeSheetName(device));

    ws.columns = [{ header: "Scanned IMEI", key: "imei", width: 32 }];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        "attachment; filename=end_of_month_stock_count.xlsx",
      "Cache-Control": "no-store",
    },
  });
}