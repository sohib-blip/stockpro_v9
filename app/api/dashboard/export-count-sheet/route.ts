import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  authorizeCapabilityRequest,
  supabaseService,
} from "@/lib/auth";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_COUNT_SHEET_ROWS = 25_000;
const MAX_COUNT_SHEET_DEVICES = 80;
const MAX_FORMULA_CELLS = 500_000;
const MAX_COUNT_SHEET_BYTES = 32 * 1024 * 1024;
const MIN_SCAN_ROWS = 1_000;
const EXTRA_SCAN_ROWS = 500;

function scanRowsForDevice(expectedImeis: number) {
  return Math.max(expectedImeis + EXTRA_SCAN_ROWS, MIN_SCAN_ROWS);
}

function safeSheetName(name: string) {
  return String(name || "Unknown")
    .replace(/[\\/?*[\]:]/g, "-")
    .substring(0, 31);
}

function excelSheetName(name: string) {
  return `'${name.replace(/'/g, "''")}'`;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A8A" },
  };
  row.alignment = { vertical: "middle", horizontal: "center" };
}

function styleSheet(ws: ExcelJS.Worksheet) {
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getRow(1).height = 22;
  styleHeader(ws.getRow(1));
}

export async function GET(req: Request) {
  const authorization = await authorizeCapabilityRequest(
    req,
    "inventory.export.raw"
  );
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status }
    );
  }

  const admission = await acquireWorkloadLease(req, "countSheetExport", {
    principal: authorization.user.id,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const supabase = supabaseService();
    let allRows: any[] = [];
    const pageSize = 1000;
    const requestedRows = MAX_COUNT_SHEET_ROWS + 1;

    while (allRows.length < requestedRows) {
      const from = allRows.length;
      const to =
        from + Math.min(pageSize, requestedRows - allRows.length) - 1;

      const { data, error } = await supabase
        .from("stock_export_view")
        .select("item_id, device, imei")
        .order("item_id", { ascending: true })
        .range(from, to);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      if (!data || data.length === 0) break;

      allRows.push(...data);

      if (data.length < to - from + 1) break;
    }

    if (allRows.length > MAX_COUNT_SHEET_ROWS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Count sheet exceeds the ${MAX_COUNT_SHEET_ROWS}-row synchronous limit.`,
        },
        { status: 413 }
      );
    }

    const deviceMap: Record<string, string[]> = {};

    for (const row of allRows) {
      const device = row.device || "Unknown";
      const imei = String(row.imei || "").trim();

      if (!imei) continue;

      if (!deviceMap[device]) deviceMap[device] = [];
      deviceMap[device].push(imei);
    }

    const devices = Object.keys(deviceMap).sort();
    const estimatedFormulaCells = devices.reduce((total, device) => {
      const expected = deviceMap[device].length;
      return total + (scanRowsForDevice(expected) - 1) * 5 + expected * 3;
    }, 0);

    if (
      devices.length > MAX_COUNT_SHEET_DEVICES ||
      estimatedFormulaCells > MAX_FORMULA_CELLS
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Count-sheet workbook exceeds the synchronous formula budget.",
        },
        { status: 413 }
      );
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "StockPro";
    wb.created = new Date();

    const sheetNameMap: Record<string, string> = {};

    for (const device of devices) {
      let base = safeSheetName(device);
      let finalName = base;
      let counter = 1;

      while (Object.values(sheetNameMap).includes(finalName)) {
        finalName = `${base.substring(0, 27)}-${counter}`;
        counter++;
      }

      sheetNameMap[device] = finalName;
    }

    // ================= SUMMARY =================
    const summary = wb.addWorksheet("Summary");

    summary.columns = [
      { header: "Device", key: "device", width: 30 },
      { header: "Expected", key: "expected", width: 14 },
      { header: "Found", key: "found", width: 14 },
      { header: "Missing", key: "missing", width: 14 },
      { header: "Unexpected", key: "unexpected", width: 16 },
      { header: "Variance", key: "variance", width: 14 },
      { header: "Status", key: "status", width: 16 },
    ];

    styleSheet(summary);

    devices.forEach((device, index) => {
      const rowNumber = index + 2;
      const sheetName = sheetNameMap[device];
      const sheetRef = excelSheetName(sheetName);

      summary.getCell(`A${rowNumber}`).value = device;
      summary.getCell(`B${rowNumber}`).value = deviceMap[device].length;
      summary.getCell(`C${rowNumber}`).value = {
        formula: `COUNTIF(${sheetRef}!C:C,"FOUND")`,
      };
      summary.getCell(`D${rowNumber}`).value = {
        formula: `COUNTIF(${sheetRef}!C:C,"MISSING")`,
      };
      summary.getCell(`E${rowNumber}`).value = {
        formula: `COUNTIF(${sheetRef}!D:D,"UNEXPECTED")`,
      };
      summary.getCell(`F${rowNumber}`).value = {
        formula: `C${rowNumber}-B${rowNumber}+E${rowNumber}`,
      };
      summary.getCell(`G${rowNumber}`).value = {
        formula: `IF(AND(D${rowNumber}=0,E${rowNumber}=0),"OK",IF(E${rowNumber}>0,"UNEXPECTED","MISSING"))`,
      };
    });

    const totalRow = devices.length + 2;
    summary.getCell(`A${totalRow}`).value = "TOTAL";
    summary.getCell(`B${totalRow}`).value = { formula: `SUM(B2:B${totalRow - 1})` };
    summary.getCell(`C${totalRow}`).value = { formula: `SUM(C2:C${totalRow - 1})` };
    summary.getCell(`D${totalRow}`).value = { formula: `SUM(D2:D${totalRow - 1})` };
    summary.getCell(`E${totalRow}`).value = { formula: `SUM(E2:E${totalRow - 1})` };
    summary.getCell(`F${totalRow}`).value = { formula: `SUM(F2:F${totalRow - 1})` };
    summary.getCell(`G${totalRow}`).value = {
      formula: `IF(AND(D${totalRow}=0,E${totalRow}=0),"OK",IF(E${totalRow}>0,"UNEXPECTED","MISSING"))`,
    };

    summary.getRow(totalRow).font = { bold: true, color: { argb: "FFFFFFFF" } };
    summary.getRow(totalRow).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" },
    };

    (summary as any).addConditionalFormatting({
      ref: `G2:G${totalRow}`,
      rules: [
        {
          type: "containsText",
          operator: "containsText",
          text: "OK",
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } },
            font: { color: { argb: "FF006100" }, bold: true },
          },
        },
        {
          type: "containsText",
          operator: "containsText",
          text: "MISSING",
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
            font: { color: { argb: "FF9C0006" }, bold: true },
          },
        },
        {
          type: "containsText",
          operator: "containsText",
          text: "UNEXPECTED",
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } },
            font: { color: { argb: "FFFF6D00" }, bold: true },
          },
        },
      ],
    });

    // ================= DETAIL SHEETS =================
    for (const device of devices) {
      const sheetName = sheetNameMap[device];
      const ws = wb.addWorksheet(sheetName);
      const expectedImeis = deviceMap[device].sort();
      const scanRows = scanRowsForDevice(expectedImeis.length);

      ws.columns = [
        { header: "Expected IMEI", key: "expected", width: 24 },
        { header: "Scanned IMEI", key: "scanned", width: 24 },
        { header: "Expected Status", key: "expected_status", width: 18 },
        { header: "Scanned Status", key: "scanned_status", width: 18 },
      ];

      styleSheet(ws);

      expectedImeis.forEach((imei, idx) => {
        ws.getCell(`A${idx + 2}`).value = imei;
      });

      for (let i = 2; i <= scanRows; i++) {
        ws.getCell(`C${i}`).value = {
          formula: `IF(A${i}="","",IF(COUNTIF($B:$B,A${i})>0,"FOUND","MISSING"))`,
        };

        ws.getCell(`D${i}`).value = {
          formula: `IF(B${i}="","",IF(COUNTIF($A:$A,B${i})>0,"FOUND","UNEXPECTED"))`,
        };
      }

      (ws as any).addConditionalFormatting({
        ref: `A2:A${scanRows}`,
        rules: [
          {
            type: "expression",
            formulae: [`$C2="FOUND"`],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } },
              font: { color: { argb: "FF006100" }, bold: true },
            },
          },
          {
            type: "expression",
            formulae: [`$C2="MISSING"`],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
              font: { color: { argb: "FF9C0006" }, bold: true },
            },
          },
        ],
      });

      (ws as any).addConditionalFormatting({
        ref: `B2:B${scanRows}`,
        rules: [
          {
            type: "expression",
            formulae: [`$D2="FOUND"`],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } },
              font: { color: { argb: "FF006100" }, bold: true },
            },
          },
          {
            type: "expression",
            formulae: [`$D2="UNEXPECTED"`],
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } },
              font: { color: { argb: "FFFF6D00" }, bold: true },
            },
          },
        ],
      });

      (ws as any).addConditionalFormatting({
        ref: `C2:D${scanRows}`,
        rules: [
          {
            type: "containsText",
            operator: "containsText",
            text: "FOUND",
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFC6EFCE" } },
              font: { color: { argb: "FF006100" }, bold: true },
            },
          },
          {
            type: "containsText",
            operator: "containsText",
            text: "MISSING",
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
              font: { color: { argb: "FF9C0006" }, bold: true },
            },
          },
          {
            type: "containsText",
            operator: "containsText",
            text: "UNEXPECTED",
            style: {
              fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } },
              font: { color: { argb: "FFFF6D00" }, bold: true },
            },
          },
        ],
      });
    }

    // ================= MISSING IMEIS =================
const missing = wb.addWorksheet("Missing IMEIs");

missing.columns = [
  { header: "Device", key: "device", width: 30 },
  { header: "Missing IMEI", key: "imei", width: 24 },
  { header: "Status", key: "status", width: 16 },
];

styleSheet(missing);

let missingRow = 2;

for (const device of devices) {
  const sheetName = sheetNameMap[device];
  const sheetRef = excelSheetName(sheetName);
  const count = deviceMap[device].length;

  for (let i = 2; i <= count + 1; i++) {
    missing.getCell(`A${missingRow}`).value = {
      formula: `IF(${sheetRef}!C${i}="MISSING","${device.replace(/"/g, '""')}","")`,
    };

    missing.getCell(`B${missingRow}`).value = {
      formula: `IF(${sheetRef}!C${i}="MISSING",${sheetRef}!A${i},"")`,
    };

    missing.getCell(`C${missingRow}`).value = {
      formula: `IF(B${missingRow}<>"","MISSING","")`,
    };

    missingRow++;
  }
}

missing.autoFilter = {
  from: "A1",
  to: "C1",
};

(missing as any).addConditionalFormatting({
  ref: `B2:B${missingRow}`,
  rules: [
    {
      type: "expression",
      formulae: [`$C2="MISSING"`],
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
        font: { color: { argb: "FF9C0006" }, bold: true },
      },
    },
  ],
});

(missing as any).addConditionalFormatting({
  ref: `C2:C${missingRow}`,
  rules: [
    {
      type: "containsText",
      operator: "containsText",
      text: "MISSING",
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
        font: { color: { argb: "FF9C0006" }, bold: true },
      },
    },
  ],
});

    // ================= UNEXPECTED IMEIS =================
const unexpected = wb.addWorksheet("Unexpected IMEIs");

unexpected.columns = [
  { header: "Device", key: "device", width: 30 },
  { header: "Unexpected IMEI", key: "imei", width: 24 },
  { header: "Status", key: "status", width: 16 },
];

styleSheet(unexpected);

let unexpectedRow = 2;

for (const device of devices) {
  const sheetName = sheetNameMap[device];
  const sheetRef = excelSheetName(sheetName);
  const scanRows = scanRowsForDevice(deviceMap[device].length);

  for (let i = 2; i <= scanRows; i++) {
    unexpected.getCell(`A${unexpectedRow}`).value = {
      formula: `IF(${sheetRef}!D${i}="UNEXPECTED","${device.replace(/"/g, '""')}","")`,
    };

    unexpected.getCell(`B${unexpectedRow}`).value = {
      formula: `IF(${sheetRef}!D${i}="UNEXPECTED",${sheetRef}!B${i},"")`,
    };

    unexpected.getCell(`C${unexpectedRow}`).value = {
      formula: `IF(B${unexpectedRow}<>"","UNEXPECTED","")`,
    };

    unexpectedRow++;
  }
}

unexpected.autoFilter = {
  from: "A1",
  to: "C1",
};

(unexpected as any).addConditionalFormatting({
  ref: `B2:B${unexpectedRow}`,
  rules: [
    {
      type: "expression",
      formulae: [`$C2="UNEXPECTED"`],
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } },
        font: { color: { argb: "FFFF6D00" }, bold: true },
      },
    },
  ],
});

(unexpected as any).addConditionalFormatting({
  ref: `C2:C${unexpectedRow}`,
  rules: [
    {
      type: "containsText",
      operator: "containsText",
      text: "UNEXPECTED",
      style: {
        fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE0B2" } },
        font: { color: { argb: "FFFF6D00" }, bold: true },
      },
    },
  ],
});

const buffer = await wb.xlsx.writeBuffer();

if (buffer.byteLength > MAX_COUNT_SHEET_BYTES) {
  return NextResponse.json(
    { ok: false, error: "Generated count sheet is too large." },
    { status: 413 }
  );
}

return new NextResponse(buffer, {
  headers: {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition":
      "attachment; filename=end_of_month_stock_count_detailed.xlsx",
    "Cache-Control": "no-store",
  },
});

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export count sheet failed" },
      { status: 500 }
    );
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
