// lib/inbound/parsers.ts

import * as XLSX from "xlsx";
import {
  DeviceMatch,
  ParsedLabel,
  ParseResult,
  Vendor,
  isImei,
  makeFail,
  makeOk,
  norm,
  resolveDeviceDisplay,
  uniq,
} from "./vendorParser";

/**
 * Helpers lecture XLSX
 */
function sheetToRows(bytes: Uint8Array): any[][] {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
  return rows || [];
}

/**
 * Find best IMEI column by scanning rows:
 * returns column index that contains most "IMEI-like" values (14-17 digits).
 */
function detectImeiColumn(rows: any[][], maxScanRows = 60): number {
  const scanRows = rows.slice(0, Math.min(rows.length, maxScanRows));
  const maxCols = Math.max(...scanRows.map((r) => (r ? r.length : 0)), 0);

  const counts = new Array(maxCols).fill(0);

  const looksLikeImei = (v: any) => {
    const digits = String(v ?? "").replace(/\D/g, "");
    return /^\d{14,17}$/.test(digits);
  };

  for (const r of scanRows) {
    for (let c = 0; c < maxCols; c++) {
      if (looksLikeImei(r?.[c])) counts[c] += 1;
    }
  }

  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > bestScore) {
      bestScore = counts[i];
      bestIdx = i;
    }
  }

  if (bestScore >= 3) return bestIdx;

  return -1;
}

/**
 * TELTONIKA parser (format en blocs horizontaux)
 */
export function parseTeltonikaExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const debug: Record<string, any> = {};
  const unknown: string[] = [];

  const multOf = (deviceDisplay: string) =>
    devices.find((d) => d.display === deviceDisplay)?.units_per_imei ?? 1;

  // 1) header row detection
  let headerRowIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = (rows[r] || []).map(norm);
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) {
    return makeFail("Could not detect header row (need BOX + IMEI headers)", [], {
      sampleTop: rows.slice(0, 10),
    });
  }

  const header = (rows[headerRowIdx] || []).map(norm);

  // 2) detect blocks
  const blocks: Array<{ start: number; boxCol1: number; boxCol2: number; imeiCol: number }> = [];
  for (let c = 0; c < header.length; c++) {
    const h = header[c] || "";
    const isBox = h === "box no." || (h.includes("box") && h.includes("no"));
    if (!isBox) continue;

    let imeiCol = -1;
    for (let k = c; k <= Math.min(header.length - 1, c + 14); k++) {
      if ((header[k] || "").includes("imei")) {
        imeiCol = k;
        break;
      }
    }
    if (imeiCol < 0) continue;

    const boxCol1 = c;
    const boxCol2 = Math.min(c + 1, header.length - 1);

    const already = blocks.some((b) => Math.abs(b.start - c) <= 2);
    if (already) continue;

    blocks.push({ start: c, boxCol1, boxCol2, imeiCol });
  }

  blocks.sort((a, b) => a.start - b.start);

  debug.headerRowIdx = headerRowIdx;
  debug.blocks = blocks;

  if (!blocks.length) {
    return makeFail("No blocks detected (expected repeated Box No + IMEI sections)", [], debug);
  }

  // 3) device name above block
  function deviceNameAbove(blockStartCol: number): string | null {
    for (let r = headerRowIdx - 1; r >= 0; r--) {
      const v = String((rows[r] || [])[blockStartCol] ?? "").trim();
      if (v) return v;
    }
    return null;
  }

  function hasLetters(v: any): boolean {
    return /[A-Z]/i.test(String(v ?? ""));
  }

  function extractRawDeviceFromCell(v: any): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    if (!hasLetters(s)) return null;

    const p = s.split("-")[0]?.trim();
    return p || null;
  }

  function extractBoxNoFromCell(v: any): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;

    const parts = s.split("-").map((x) => String(x).trim()).filter(Boolean);

    if (parts.length >= 3 && hasLetters(parts[0])) {
      return `${parts[1]}-${parts[2]}`;
    }

    if (parts.length === 2 && !hasLetters(parts[0])) {
      return `${parts[0]}-${parts[1]}`;
    }

    return parts[0] || null;
  }

  function pickDeviceCell(a: any, b: any): any | null {
    if (hasLetters(a)) return a;
    if (hasLetters(b)) return b;
    return null;
  }

  function pickBoxCell(a: any, b: any): any | null {
    const sa = String(a ?? "").trim();
    const sb = String(b ?? "").trim();

    if (sa.includes("-")) return a;
    if (sb.includes("-")) return b;

    if (sa) return a;
    if (sb) return b;

    return null;
  }

  const byKey = new Map<
    string,
    { vendor: Vendor; device: string; box_no: string; imeis: string[] }
  >();

  for (const b of blocks) {
    const rawAbove = deviceNameAbove(b.start) || "";
    let currentDeviceDisplay: string | null = null;

    const aboveResolved = rawAbove.trim() ? resolveDeviceDisplay(rawAbove.trim(), devices) : null;
    if (rawAbove.trim() && !aboveResolved) unknown.push(rawAbove.trim());
    currentDeviceDisplay = aboveResolved;

    let currentBoxNo: string | null = null;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      const boxCell1 = row[b.boxCol1];
      const boxCell2 = row[b.boxCol2];

      const devCell = pickDeviceCell(boxCell1, boxCell2);
      if (devCell !== null) {
        const rawFromCell = extractRawDeviceFromCell(devCell);
        if (rawFromCell) {
          const resolved = resolveDeviceDisplay(rawFromCell, devices);
          if (!resolved) unknown.push(rawFromCell);
          currentDeviceDisplay = resolved || currentDeviceDisplay;
        }
      }

      const bxCell = pickBoxCell(boxCell1, boxCell2);
      if (bxCell !== null) {
        const boxNo = extractBoxNoFromCell(bxCell);
        if (boxNo) currentBoxNo = boxNo;
      }

      const imei = isImei(row[b.imeiCol]);
      if (!imei) continue;

      if (!currentDeviceDisplay || !currentBoxNo) continue;

      const key = `${currentDeviceDisplay}__${currentBoxNo}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          vendor: "teltonika",
          device: currentDeviceDisplay,
          box_no: currentBoxNo,
          imeis: [],
        });
      }
      byKey.get(key)!.imeis.push(imei);
    }
  }

  if (uniq(unknown).length > 0) {
    return makeFail(
      `device(s) not found in Admin > Devices: ${uniq(unknown).join(", ")}`,
      uniq(unknown),
      debug
    );
  }

  const labels: ParsedLabel[] = Array.from(byKey.values()).map((x) => {
    const imeis = uniq(x.imeis);
    const qty = imeis.length * multOf(x.device);
    return {
      vendor: x.vendor,
      device: x.device,
      box_no: x.box_no,
      imeis,
      qty,
      qr_data: "",
    };
  });

  return makeOk(labels, debug, []);
}

/**
 * QUICKLINK
 * ✅ Fix: auto-match CNHYCV200XEU2025... => CV200
 */
export function parseQuicklinkExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const multOf = (deviceDisplay: string) =>
    devices.find((d) => d.display === deviceDisplay)?.units_per_imei ?? 1;

  const header = (rows[0] || []).map(norm);
  const idxImei = header.findIndex((h) => h === "imei" || h.includes("imei"));
  const idxCarton = header.findIndex((h) => h === "carton" || h.includes("carton"));

  if (idxImei < 0) return makeFail("Quicklink: IMEI column not found", [], { header });
  if (idxCarton < 0) return makeFail("Quicklink: Carton column not found", [], { header });

  const debug: Record<string, any> = { header };
  const unknown: string[] = [];

  function extractBoxNo(carton: any): string | null {
    const s = String(carton ?? "").trim();
    if (!s) return null;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 5) return digits.slice(-5);
    return s.slice(-5) || null;
  }

  function guessDeviceRaw(carton: any): string | null {
    const s = String(carton ?? "").toUpperCase();
    if (!s) return null;

    if (s.includes("CV200")) return "CV200";

    const m = s.match(/\b([A-Z]{2,}\d{2,}[A-Z0-9]{0,})\b/);
    return m ? m[1] : null;
  }

  const guesses: Record<string, number> = {};
  for (let r = 1; r < rows.length; r++) {
    const carton = (rows[r] || [])[idxCarton];
    const g = guessDeviceRaw(carton);
    if (g) guesses[g] = (guesses[g] || 0) + 1;
  }

  const deviceRawBest = Object.entries(guesses).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  if (!deviceRawBest) {
    return makeFail("Quicklink: could not guess device name from Carton", [], debug);
  }

  const deviceDisplay =
  resolveDeviceDisplay(deviceRawBest, devices);

  if (!deviceDisplay) {
    unknown.push(deviceRawBest);
    return makeFail(
      `device(s) not found in Admin > Devices: ${uniq(unknown).join(", ")}`,
      uniq(unknown),
      { ...debug, deviceRawBest }
    );
  }

  const byBox = new Map<string, string[]>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const imei = isImei(row[idxImei]);
    if (!imei) continue;

    const boxNo = extractBoxNo(row[idxCarton]);
    if (!boxNo) continue;

    const key = `${deviceDisplay}__${boxNo}`;
    if (!byBox.has(key)) byBox.set(key, []);
    byBox.get(key)!.push(imei);
  }

  const labels: ParsedLabel[] = Array.from(byBox.entries()).map(([key, imeis]) => {
    const box_no = key.split("__")[1] || "";
    const uniqImeis = uniq(imeis);
    const qty = uniqImeis.length * multOf(deviceDisplay);

    return {
      vendor: "quicklink",
      device: deviceDisplay,
      box_no,
      imeis: uniqImeis,
      qty,
      qr_data: "",
    };
  });

  return makeOk(labels, { ...debug, deviceRawBest, deviceDisplay }, []);
}

/**
 * DIGITALMATTER
 */
export function parseDigitalMatterExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const multOf = (deviceDisplay: string) =>
    devices.find((d) => d.display === deviceDisplay)?.units_per_imei ?? 1;

  const header = (rows[0] || []).map(norm);
  const idxProd = header.findIndex((h) => h === "product name" || h.includes("product"));
  const idxImei = header.findIndex((h) => h.includes("imei"));
  const idxBoxid = header.findIndex((h) => h === "boxid" || h.includes("boxid"));

  if (idxProd < 0) return makeFail("DigitalMatter: Product Name column not found", [], { header });
  if (idxImei < 0) return makeFail("DigitalMatter: IMEI/PACCODE column not found", [], { header });
  if (idxBoxid < 0) return makeFail("DigitalMatter: BOXID column not found", [], { header });

  const unknown: string[] = [];
  const debug: Record<string, any> = { header };

  const byKey = new Map<string, string[]>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];

    const imei = isImei(row[idxImei]);
    if (!imei) continue;

    const rawDevice = String(row[idxProd] ?? "").trim();
    if (!rawDevice) continue;

    const deviceDisplay = resolveDeviceDisplay(rawDevice, devices);
    if (!deviceDisplay) {
      unknown.push(rawDevice);
      continue;
    }

    const boxNo = String(row[idxBoxid] ?? "").trim();
    if (!boxNo) continue;

    const key = `${deviceDisplay}__${boxNo}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(imei);
  }

  if (uniq(unknown).length > 0) {
    return makeFail(
      `device(s) not found in Admin > Devices: ${uniq(unknown).join(", ")}`,
      uniq(unknown),
      debug
    );
  }

  const labels: ParsedLabel[] = Array.from(byKey.entries()).map(([key, imeis]) => {
    const box_no = key.split("__")[1] || "";
    const device = key.split("__")[0] || "";
    const uniqImeis = uniq(imeis);
    const qty = uniqImeis.length * multOf(device);

    return {
      vendor: "digitalmatter",
      device,
      box_no,
      imeis: uniqImeis,
      qty,
      qr_data: "",
    };
  });

  return makeOk(labels, debug, []);
}

/**
 * TRUSTED / TRUSTER
 * ✅ 1 Excel = 1 box
 * ✅ accepte "Serialnumber" comme IMEI
 * ✅ auto-detect colonne IMEI si header change
 * ✅ device forcé (ici: Neon-R T7)
 */
export function parseTrustedExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const multOf = (deviceDisplay: string) =>
    devices.find((d) => d.display === deviceDisplay)?.units_per_imei ?? 1;

  const header = (rows[0] || []).map(norm);

  const idxImeiHeader = header.findIndex((h) => {
    const x = String(h || "");
    return (
      x === "imei" ||
      x.includes("imei") ||
      x === "serialnumber" ||
      x === "serial number" ||
      x.includes("serialnumber") ||
      x.includes("serial number") ||
      x === "serial"
    );
  });

  const idxImei = idxImeiHeader >= 0 ? idxImeiHeader : detectImeiColumn(rows, 60);

  if (idxImei < 0) {
    return makeFail(
      "Truster: IMEI/Serial column not found (expected IMEI or Serialnumber, or a column with many 15-digit values)",
      [],
      { header, sampleTop: rows.slice(0, 10) }
    );
  }

  const debug: Record<string, any> = { header, idxImei };

  const forcedDeviceRaw = "Neon-R T7";
  const deviceDisplay = resolveDeviceDisplay(forcedDeviceRaw, devices);

  if (!deviceDisplay) {
    return makeFail(
      `device(s) not found in Admin > Devices: ${forcedDeviceRaw}`,
      [forcedDeviceRaw],
      { ...debug, forcedDeviceRaw }
    );
  }

  const allImeis: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const imei = isImei((rows[r] || [])[idxImei]);
    if (imei) allImeis.push(imei);
  }

  const uniqueImeis = uniq(allImeis);

  if (!uniqueImeis.length) {
    return makeFail("Truster: no IMEI parsed from Serial/IMEI column", [], {
      ...debug,
      deviceDisplay,
    });
  }

  const qty = uniqueImeis.length * multOf(deviceDisplay);

  const labels: ParsedLabel[] = [
    {
      vendor: "truster",
      device: deviceDisplay,
      box_no: "1",
      imeis: uniqueImeis,
      qty,
      qr_data: "",
    },
  ];

  return makeOk(labels, { ...debug, deviceDisplay, mode: "single_box" }, []);
}

/**
 * Router principal
 */
export function parseVendorExcel(vendor: Vendor, bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  switch (vendor) {
    case "teltonika":
      return parseTeltonikaExcel(bytes, devices);
    case "quicklink":
      return parseQuicklinkExcel(bytes, devices);
    case "digitalmatter":
      return parseDigitalMatterExcel(bytes, devices);
    case "truster":
      return parseTrustedExcel(bytes, devices);
    default:
      return makeFail("Unknown vendor", [], { vendor });
  }
}