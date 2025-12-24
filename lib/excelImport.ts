import * as XLSX from "xlsx";

const IMEI15_RE = /^[0-9]{15}$/;

export type ParsedRow = {
  rowNumber: number;
  device_raw: string;
  device: string;
  box_no: string;
  imei: string;
};

export type PreviewResult = {
  headerRowIdx: number;
  columns: { deviceCol: number; boxCol: number; imeiCol: number };
  parsed: ParsedRow[];
  issues: { row: number; field: string; message: string }[];
  boxes: { box_no: string; device: string; qty: number }[];
};

function normHeader(v: any) {
  return String(v ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

function cleanDigits(v: any): string {
  let s = String(v ?? "").trim();
  if (!s) return "";
  s = s.replace(/\.0$/, "");
  s = s.replace(/[^\d]/g, "");
  return s;
}

function normalizeDevice(raw: string) {
  const s = raw.trim();
  const base = s.split("-")[0]?.trim();
  return base || s;
}

function findHeaderRow(rows: any[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const joined = (rows[i] ?? []).map(normHeader).join(" ");
    if (joined.includes("imei") || joined.includes("serial")) return i;
  }
  return Math.min(1, rows.length - 1);
}

// ✅ Smart: choose the column that contains the MOST 15-digit numbers in the first N rows
function pickImeiColByData(rows: any[][], headerRowIdx: number): number {
  const header = rows[headerRowIdx] ?? [];
  const colCount = header.length;
  const sample = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + 60);

  let bestCol = -1;
  let bestScore = 0;

  for (let c = 0; c < colCount; c++) {
    let score = 0;
    for (const r of sample) {
      const val = cleanDigits(r?.[c]);
      if (IMEI15_RE.test(val)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }

  return bestCol; // -1 if none
}

// ✅ Smart: box column usually looks like "025-36" or "22060" (short non-empty, not 15-digit)
function pickBoxColByData(rows: any[][], headerRowIdx: number, avoidCols: number[]): number {
  const header = rows[headerRowIdx] ?? [];
  const colCount = header.length;
  const sample = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + 60);

  const boxLike = (s: string) => {
    if (!s) return false;
    // common patterns: 025-36, 22060, BOX123, etc.
    if (/^\d{2,6}$/.test(s)) return true;
    if (/^\d{2,4}-\d{1,4}$/.test(s)) return true;
    if (/^box\s*\d+/i.test(s)) return true;
    return false;
  };

  let bestCol = -1;
  let bestScore = 0;

  for (let c = 0; c < colCount; c++) {
    if (avoidCols.includes(c)) continue;

    let score = 0;
    for (const r of sample) {
      const raw = String(r?.[c] ?? "").trim();
      const digits = cleanDigits(raw);

      // avoid picking IMEI column
      if (IMEI15_RE.test(digits)) continue;

      if (boxLike(raw) || boxLike(digits)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }

  return bestCol;
}

// ✅ Device column: usually a text with letters (not numeric), often contains model like FMC...
function pickDeviceColByData(rows: any[][], headerRowIdx: number, avoidCols: number[]): number {
  const header = rows[headerRowIdx] ?? [];
  const colCount = header.length;
  const sample = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + 60);

  let bestCol = -1;
  let bestScore = 0;

  for (let c = 0; c < colCount; c++) {
    if (avoidCols.includes(c)) continue;

    let score = 0;
    for (const r of sample) {
      const raw = String(r?.[c] ?? "").trim();
      if (!raw) continue;

      // contains letters = likely device/model
      if (/[A-Za-z]/.test(raw)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }

  return bestCol;
}

export function parseSupplierExcel(buffer: Buffer): PreviewResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });

  const headerRowIdx = findHeaderRow(rows);

  // 1) IMEI col by DATA (most reliable)
  let imeiCol = pickImeiColByData(rows, headerRowIdx);

  // 2) Device/Box by DATA
  const avoid = imeiCol >= 0 ? [imeiCol] : [];
  let boxCol = pickBoxColByData(rows, headerRowIdx, avoid);
  let deviceCol = pickDeviceColByData(rows, headerRowIdx, [...avoid, boxCol].filter(x => x >= 0));

  // 3) Fallbacks (if still not found)
  if (deviceCol === -1) deviceCol = 0;
  if (boxCol === -1) boxCol = 1;
  if (imeiCol === -1) {
    // last resort: try column 2
    imeiCol = 2;
  }

  const parsed: ParsedRow[] = [];
  const issues: PreviewResult["issues"] = [];

  const seenImei = new Set<string>();
  const boxToDevice = new Map<string, string>();

  rows.slice(headerRowIdx + 1).forEach((r, i) => {
    if (!r || r.every(c => String(c ?? "").trim() === "")) return;

    const rowNumber = headerRowIdx + 2 + i;

    const deviceRaw = String(r[deviceCol] ?? "").trim();
    const boxNo = String(r[boxCol] ?? "").trim();
    const imei = cleanDigits(r[imeiCol]);

    const device = normalizeDevice(deviceRaw);

    if (!deviceRaw) issues.push({ row: rowNumber, field: "device", message: "Missing device/model" });
    if (!boxNo) issues.push({ row: rowNumber, field: "box_no", message: "Missing box number" });

    // IMEI MUST be 15 digits — if your supplier uses something else, tell me and we adjust
    if (!imei) issues.push({ row: rowNumber, field: "imei", message: "Missing IMEI" });
    else if (!IMEI15_RE.test(imei)) issues.push({ row: rowNumber, field: "imei", message: `Invalid IMEI (need 15 digits): ${imei}` });

    if (IMEI15_RE.test(imei)) {
      if (seenImei.has(imei)) issues.push({ row: rowNumber, field: "imei", message: `Duplicate IMEI in file: ${imei}` });
      else seenImei.add(imei);
    }

    if (boxNo) {
      const prev = boxToDevice.get(boxNo);
      if (prev && prev !== device) {
        issues.push({ row: rowNumber, field: "box_no", message: `Box ${boxNo} has multiple devices (${prev} vs ${device})` });
      } else if (!prev) {
        boxToDevice.set(boxNo, device);
      }
    }

    parsed.push({ rowNumber, device_raw: deviceRaw, device, box_no: boxNo, imei });
  });

  const boxMap = new Map<string, number>();
  parsed.forEach(p => {
    if (IMEI15_RE.test(p.imei) && p.box_no) {
      boxMap.set(p.box_no, (boxMap.get(p.box_no) ?? 0) + 1);
    }
  });

  const boxes = Array.from(boxMap.entries()).map(([box_no, qty]) => ({
    box_no,
    device: boxToDevice.get(box_no) ?? "",
    qty,
  }));

  return {
    headerRowIdx,
    columns: { deviceCol, boxCol, imeiCol },
    parsed,
    issues,
    boxes,
  };
}
