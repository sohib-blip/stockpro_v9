import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function cellToString(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isValidImei(imei: string) {
  return /^\d{15}$/.test(imei);
}

function normalizeDevice(raw: string) {
  const s = cellToString(raw);
  if (!s) return "";
  return s.split("-")[0] || s;
}

function normalizeBox(raw: string) {
  return cellToString(raw);
}

function looksLikeBoxNo(v: any) {
  const s = cellToString(v);
  return /^\d{2,4}-\d{1,4}$/.test(s);
}

function detectCols(rows: any[][]) {
  const maxScan = Math.min(rows.length, 25);
  let deviceCol = 0;
  let boxCol = 1;
  let imeiCol = 3;

  const norm = (v: any) => cellToString(v).toLowerCase();

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r] || [];
    const cells = row.map(norm);
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (!hasImei || !hasBox) continue;

    const iIdx = cells.findIndex((c) => c.includes("imei"));
    if (iIdx >= 0) imeiCol = iIdx;

    // if there are multiple box columns, prefer the one whose first data row looks like "025-36"
    const candidates: number[] = [];
    cells.forEach((c, idx) => {
      if (c.includes("box")) candidates.push(idx);
    });
    const firstData = rows[r + 1] || [];
    const preferred = candidates.find((idx) => looksLikeBoxNo(firstData[idx]));
    if (preferred !== undefined) boxCol = preferred;
    else if (candidates.length) boxCol = candidates[candidates.length - 1];

    // device sometimes isn't in headers; keep default 0
    const dIdx = cells.findIndex((c) => c.includes("device") || c.includes("model") || c.includes("type"));
    if (dIdx >= 0) deviceCol = dIdx;

    break;
  }

  return { deviceCol, boxCol, imeiCol };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Preview route OK (use POST with FormData[file])",
  });
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    // Columns can be provided either as individual fields or as JSON in "columns"
    const columnsRaw = form.get("columns");
    let parsedCols: any = null;
    if (typeof columnsRaw === "string" && columnsRaw.trim()) {
      try {
        parsedCols = JSON.parse(columnsRaw);
      } catch {
        parsedCols = null;
      }
    }


    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });

    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ ok: false, error: "No sheet found in Excel" }, { status: 400 });
    }

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    const detected = parsedCols
      ? {
          deviceCol: Number(parsedCols.deviceCol ?? 0),
          boxCol: Number(parsedCols.boxCol ?? 1),
          imeiCol: Number(parsedCols.imeiCol ?? 3),
        }
      : detectCols(rows);

    const deviceCol = detected.deviceCol;
    const boxCol = detected.boxCol;
    const imeiCol = detected.imeiCol;

    const defaultDeviceTop = normalizeDevice(rows?.[0]?.[0]);

    const issues: { row: number; field: string; message: string }[] = [];
    const sample: any[] = [];
    const boxesMap = new Map<string, { box_no: string; device: string; qty: number }>();

    let detectedRows = 0;

    let currentDevice = "";
    let currentBox = "";

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];

      const device_raw = cellToString(row[deviceCol]);
      const box_raw = cellToString(row[boxCol]);
      const imei_raw = cellToString(row[imeiCol]);

      if (!device_raw && !box_raw && !imei_raw) continue;

      const maybeDevice = normalizeDevice(device_raw);
      const maybeBox = normalizeBox(box_raw);
      if (maybeDevice) currentDevice = maybeDevice;
      if (!currentDevice && defaultDeviceTop) currentDevice = defaultDeviceTop;
      if (maybeBox) currentBox = maybeBox;

      const device = currentDevice;
      const box_no = currentBox;
      const imei = imei_raw;

      if (!device && !box_no && !imei) continue;

      detectedRows++;

      if (imei && !isValidImei(imei)) {
        issues.push({ row: i + 1, field: "imei", message: `Invalid IMEI: ${imei}` });
      }
      if (!box_no) issues.push({ row: i + 1, field: "box_no", message: "Missing box_no" });
      if (!device) issues.push({ row: i + 1, field: "device", message: "Missing device" });

      if (sample.length < 20) {
        sample.push({ rowNumber: i + 1, device_raw, device, box_no, imei });
      }

      if (box_no && device && isValidImei(imei)) {
        const key = `${device}__${box_no}`;
        const current = boxesMap.get(key);
        if (current) current.qty += 1;
        else boxesMap.set(key, { box_no, device, qty: 1 });
      }
    }

    const boxes = Array.from(boxesMap.values());
    const ok = boxes.length > 0;

    return NextResponse.json({
      ok,
      meta: {
        headerRowIdx: 1,
        columns: { deviceCol, boxCol, imeiCol },
        rows: detectedRows,
        boxes: boxes.length,
      },
      boxes,
      sample,
      issues,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Preview error" }, { status: 500 });
  }
}


