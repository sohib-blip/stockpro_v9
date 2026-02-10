// lib/inbound/parsers.ts

import * as XLSX from "xlsx";
import {
  DeviceMatch,
  ParsedLabel,
  ParseResult,
  Vendor,
  canonicalize,
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
 * TELTONIKA parser (format en blocs horizontaux)
 * Règle (comme tu as demandé):
 * - device name = cellule AU-DESSUS du bloc (dans les premières lignes)
 * - boxCell dans la 1ère colonne du bloc, sinon si vide -> 2ème colonne du bloc
 * - boxNo = partie après premier "-" => ex FMC9202MAUWU-041-2 -> 041-2
 * - IMEI = colonne "IMEI" dans chaque bloc
 */
export function parseTeltonikaExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const debug: Record<string, any> = {};
  const unknown: string[] = [];

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
    return makeFail("Could not detect header row (need BOX + IMEI headers)", [], { sampleTop: rows.slice(0, 10) });
  }

  const header = (rows[headerRowIdx] || []).map(norm);

  // 2) detect blocks = columns with "box no." (or box+no) then within next 14 cols a "imei"
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

    // box col2 sometimes is next column (some suppliers place boxnr in 2nd column)
    const boxCol1 = c;
    const boxCol2 = Math.min(c + 1, header.length - 1);

    // avoid near-duplicates
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

  // 3) device name above block: scan upwards from header row to row 0 in same column start
  function deviceNameAbove(blockStartCol: number): string | null {
    for (let r = headerRowIdx - 1; r >= 0; r--) {
      const v = String((rows[r] || [])[blockStartCol] ?? "").trim();
      if (v) return v;
    }
    return null;
  }

  // 4) extract box_no from cell:
  // ex "FMC9202MAUWU-041-2" => "041-2"
  function extractBoxNoFromCell(v: any): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    // take after first "-"
    const parts = s.split("-").map((x) => String(x).trim()).filter(Boolean);
    if (parts.length >= 3) {
      // ex [FMC9202MAUWU, 041, 2] => 041-2
      return `${parts[1]}-${parts[2]}`;
    }
    if (parts.length === 2) {
      // ex [FMC..., 041] => 041
      return parts[1];
    }
    // fallback: last token
    return parts[parts.length - 1] || null;
  }

  function extractRawDeviceFromCell(v: any): string | null {
    const s = String(v ?? "").trim();
    if (!s) return null;
    // device = avant le premier "-"
    const p = s.split("-")[0]?.trim();
    return p || null;
  }

  const byKey = new Map<string, { vendor: Vendor; device: string; box_no: string; imeis: string[] }>();

  for (const b of blocks) {
    const rawAbove = deviceNameAbove(b.start) || "";
    let rawDevice = rawAbove.trim() || null;

    // resolve device display
    let currentDeviceDisplay: string | null = null;
    if (rawDevice) {
      currentDeviceDisplay = resolveDeviceDisplay(rawDevice, devices);
      if (!currentDeviceDisplay) unknown.push(rawDevice);
    }

    let currentBoxNo: string | null = null;

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      // box cell: prefer col1, if empty then col2
      const boxCell1 = row[b.boxCol1];
      const boxCell2 = row[b.boxCol2];

      const boxCellStr1 = String(boxCell1 ?? "").trim();
      const boxCellStr2 = String(boxCell2 ?? "").trim();
      const pickCell = boxCellStr1 ? boxCell1 : (boxCellStr2 ? boxCell2 : null);

      if (pickCell !== null) {
        const rawFromCell = extractRawDeviceFromCell(pickCell);
        const boxNo = extractBoxNoFromCell(pickCell);

        if (rawFromCell) {
          rawDevice = rawFromCell;
          const resolved = resolveDeviceDisplay(rawFromCell, devices);
          if (!resolved) unknown.push(rawFromCell);
          currentDeviceDisplay = resolved || currentDeviceDisplay;
        }
        if (boxNo) currentBoxNo = boxNo;
      }

      const imei = isImei(row[b.imeiCol]);
      if (!imei) continue;

      if (!currentDeviceDisplay || !currentBoxNo) continue;

      const key = `${currentDeviceDisplay}__${currentBoxNo}`;
      if (!byKey.has(key)) {
        byKey.set(key, { vendor: "teltonika", device: currentDeviceDisplay, box_no: currentBoxNo, imeis: [] });
      }
      byKey.get(key)!.imeis.push(imei);
    }
  }

  // block import if unknown devices
  if (uniq(unknown).length > 0) {
    return makeFail(
      `device(s) not found in Admin > Devices: ${uniq(unknown).join(", ")}`,
      uniq(unknown),
      debug
    );
  }

  const labels: ParsedLabel[] = Array.from(byKey.values()).map((x) => ({
    vendor: x.vendor,
    device: x.device,
    box_no: x.box_no,
    imeis: uniq(x.imeis),
    qty: 0,
    qr_data: "",
  }));

  return makeOk(labels, debug, []);
}

/**
 * QUICKLINK
 * - colonnes: IMEI, Carton
 * - box_no = 5 derniers chiffres du champ Carton (digits only)
 * - device: extrait depuis le nom sheet OU depuis Carton (pattern type CV200XEU, etc.)
 */
export function parseQuicklinkExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const header = (rows[0] || []).map(norm);
  const idxImei = header.findIndex((h) => h === "imei" || h.includes("imei"));
  const idxCarton = header.findIndex((h) => h === "carton" || h.includes("carton"));
  if (idxImei < 0) return makeFail("Quicklink: IMEI column not found", [], { header });
  if (idxCarton < 0) return makeFail("Quicklink: Carton column not found", [], { header });

  const unknown: string[] = [];
  const debug: Record<string, any> = { header };

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

    // find something like CV200XEU, FMB140, FMC920 etc.
    const m = s.match(/\b([A-Z]{2,}\d{2,}[A-Z0-9]{0,})\b/);
    return m ? m[1] : null;
  }

  // device raw: pick most common guess from carton
  const guesses: Record<string, number> = {};
  for (let r = 1; r < rows.length; r++) {
    const carton = (rows[r] || [])[idxCarton];
    const g = guessDeviceRaw(carton);
    if (g) guesses[g] = (guesses[g] || 0) + 1;
  }
  const deviceRawBest =
    Object.entries(guesses).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  if (!deviceRawBest) {
    return makeFail("Quicklink: could not guess device name from Carton", [], debug);
  }

  const deviceDisplay = resolveDeviceDisplay(deviceRawBest, devices);
  if (!deviceDisplay) {
    unknown.push(deviceRawBest);
    return makeFail(
      `device(s) not found in Admin > Devices: ${uniq(unknown).join(", ")}`,
      uniq(unknown),
      debug
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
    return {
      vendor: "quicklink",
      device: deviceDisplay,
      box_no,
      imeis: uniq(imeis),
      qty: 0,
      qr_data: "",
    };
  });

  return makeOk(labels, { ...debug, deviceRawBest, deviceDisplay }, []);
}

/**
 * DIGITALMATTER
 * - colonnes: Product Name, IMEI/PACCODE, BOXID
 * - box_no = BOXID (comme tu as dit)
 * - device = Product Name -> match Admin Devices
 */
export function parseDigitalmatterExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

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
    return {
      vendor: "digitalmatter",
      device,
      box_no,
      imeis: uniq(imeis),
      qty: 0,
      qr_data: "",
    };
  });

  return makeOk(labels, debug, []);
}

/**
 * TRUSTED
 * - pas de boxnr fiable => on chunk (1,2,3...) par packs de 50 IMEI (modifiable)
 * - device: deviné via colonne Carton OU nom sheet, puis match Admin Devices
 */
export function parseTrustedExcel(bytes: Uint8Array, devices: DeviceMatch[]): ParseResult {
  const rows = sheetToRows(bytes);
  if (!rows.length) return makeFail("Empty excel file", [], {});

  const header = (rows[0] || []).map(norm);
  const idxImei = header.findIndex((h) => h === "imei" || h.includes("imei"));
  const idxCarton = header.findIndex((h) => h === "carton" || h.includes("carton"));

  if (idxImei < 0) return makeFail("Trusted: IMEI column not found", [], { header });

  const debug: Record<string, any> = { header };

  // guess device from Carton values (works for trusted/quicklink style)
  function guessDeviceRawFromCarton(v: any): string | null {
    const s = String(v ?? "").toUpperCase();
    if (!s) return null;
    const m = s.match(/\b([A-Z]{2,}\d{2,}[A-Z0-9]{0,})\b/);
    return m ? m[1] : null;
  }

  const guesses: Record<string, number> = {};
  if (idxCarton >= 0) {
    for (let r = 1; r < rows.length; r++) {
      const g = guessDeviceRawFromCarton((rows[r] || [])[idxCarton]);
      if (g) guesses[g] = (guesses[g] || 0) + 1;
    }
  }

  const deviceRawBest =
    Object.entries(guesses).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  if (!deviceRawBest) {
    return makeFail("Trusted: could not guess device (Carton missing or unparseable)", [], debug);
  }

  const deviceDisplay = resolveDeviceDisplay(deviceRawBest, devices);
  if (!deviceDisplay) {
    return makeFail(
      `device(s) not found in Admin > Devices: ${deviceRawBest}`,
      [deviceRawBest],
      debug
    );
  }

  // chunk IMEIs into 50 per box (default)
  const chunkSize = 50;
  const allImeis: string[] = [];
  for (let r = 1; r < rows.length; r++) {
    const imei = isImei((rows[r] || [])[idxImei]);
    if (imei) allImeis.push(imei);
  }

  if (!allImeis.length) {
    return makeFail("Trusted: no IMEI parsed", [], { ...debug, deviceRawBest, deviceDisplay });
  }

  const labels: ParsedLabel[] = [];
  let boxCounter = 1;

  for (let i = 0; i < allImeis.length; i += chunkSize) {
    const chunk = allImeis.slice(i, i + chunkSize);
    labels.push({
      vendor: "trusted",
      device: deviceDisplay,
      box_no: String(boxCounter), // 1,2,3...
      imeis: uniq(chunk),
      qty: 0,
      qr_data: "",
    });
    boxCounter++;
  }

  return makeOk(labels, { ...debug, deviceRawBest, deviceDisplay, chunkSize }, []);
}

/**
 * Router principal: appelle le bon parser par vendor
 */
export function parseVendorExcel(
  vendor: Vendor,
  bytes: Uint8Array,
  devices: DeviceMatch[]
): ParseResult {
  switch (vendor) {
    case "teltonika":
      return parseTeltonikaExcel(bytes, devices);
    case "quicklink":
      return parseQuicklinkExcel(bytes, devices);
    case "digitalmatter":
      return parseDigitalmatterExcel(bytes, devices);
    case "trusted":
      return parseTrustedExcel(bytes, devices);
    default:
      return makeFail("Unknown vendor", [], { vendor });
  }
}