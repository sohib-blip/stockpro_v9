import * as XLSX from "xlsx";

const HEADER_SCAN_LIMIT = 100;

export type EndOfDayDeviceKind =
  | "ATOM"
  | "NEON"
  | "HARDWIRED"
  | "AIO_CAMERA"
  | "OBD"
  | "TRAILER"
  | "DVR_2"
  | "DVR_4"
  | "DVR_8";

type SourceLocation = {
  sheet: string;
  row: number;
};

type DeviceRow = SourceLocation & {
  deviceKind: EndOfDayDeviceKind;
  itemType: string;
  primaryImei: string | null;
  companionImei: string | null;
};

export type EndOfDayAccessoryRow = SourceLocation & {
  orderRef: string;
  itemType: string;
  linkedImei: string | null;
};

export type EndOfDayDeviceRow = SourceLocation & {
  itemType: string;
  deviceKind: EndOfDayDeviceKind;
  primaryImei: string;
  companionImei: string | null;
  imei: string;
  linkedDvr: boolean;
};

export type EndOfDayParseIssue = SourceLocation & {
  message: string;
  itemType?: string;
};

export type EndOfDayDuplicate = {
  imei: string;
  count: number;
  locations: SourceLocation[];
};

export type EndOfDayParseResult = {
  imeis: string[];
  duplicates: EndOfDayDuplicate[];
  errors: EndOfDayParseIssue[];
  ignoredRows: number;
  ignoredItemTypes: string[];
  unknownItemTypes: string[];
  parsedSheets: string[];
  skippedSheets: string[];
  deviceRows: number;
  devices: EndOfDayDeviceRow[];
  accessories: EndOfDayAccessoryRow[];
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/^\*+/, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeHeader(value: unknown) {
  return normalizeText(value).replace(/\s+/g, "");
}

function parseImei(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    const digits = String(value);
    return /^\d{15}$/.test(digits) ? digits : null;
  }

  const text = String(value ?? "").trim();
  if (!text || /^(?:N\/?A|NONE|NULL|-)$/i.test(text)) return null;

  const cleaned = text.replace(/^'/, "").replace(/\.0$/, "").trim();
  return /^\d{15}$/.test(cleaned) ? cleaned : null;
}

export function normalizeEndOfDayLabel(value: unknown) {
  return normalizeText(value);
}

function classifyDevice(itemType: string): EndOfDayDeviceKind | null {
  const normalized = normalizeText(itemType);

  if (normalized === "ATOM") return "ATOM";
  if (normalized === "NEON") return "NEON";
  if (normalized === "HARDWIRED") return "HARDWIRED";
  if (normalized === "AIO CAMERA") return "AIO_CAMERA";
  if (normalized === "OBD") return "OBD";
  if (normalized === "TRAILER") return "TRAILER";

  if (/\bDVR\b/.test(normalized)) {
    const channel = normalized.match(/\b([248])(?:\s*CHANNEL)?\b/)?.[1];
    if (channel === "2") return "DVR_2";
    if (channel === "4") return "DVR_4";
    if (channel === "8") return "DVR_8";
  }

  return null;
}

function classifyNonDevice(itemType: string): "accessory" | "service" | null {
  const normalized = normalizeText(itemType);

  if (!normalized) return null;
  if (normalized === "KINESIS INSIGHTS") return "service";
  if (/\bCABLE\b/.test(normalized)) return "accessory";
  if (/\bANTENNA\b/.test(normalized)) return "accessory";
  if (/\bCAMERA\b/.test(normalized)) return "accessory";
  if (/\b(?:FOB|READER|BUZZER|STORAGE)\b/.test(normalized)) return "accessory";
  if (/\bTACHOGRAPH\b/.test(normalized)) return "accessory";

  return null;
}

function isDvr(deviceKind: EndOfDayDeviceKind) {
  return deviceKind === "DVR_2" || deviceKind === "DVR_4" || deviceKind === "DVR_8";
}

function findHeaderRow(rows: unknown[][]) {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = rows[rowIndex].map(normalizeHeader);
    const itemTypeIndex = headers.findIndex((header) => header === "ITEMTYPE");
    const imeiIndex = headers.findIndex(
      (header) => header === "IMEIID" || header === "IMEI"
    );

    if (itemTypeIndex < 0 || imeiIndex < 0) continue;

    return {
      rowIndex,
      itemTypeIndex,
      imeiIndex,
      orderRefIndex: headers.findIndex((header) => header === "ORDERREF"),
      companionIndex: headers.findIndex(
        (header) => header === "COMPANIONDEVICEIMEI"
      ),
    };
  }

  return null;
}

export function parseEndOfDayWorkbook(
  workbook: XLSX.WorkBook
): EndOfDayParseResult {
  const deviceRows: DeviceRow[] = [];
  const accessoryRows: EndOfDayAccessoryRow[] = [];
  const errors: EndOfDayParseIssue[] = [];
  const ignoredItemTypes = new Set<string>();
  const unknownItemTypes = new Set<string>();
  const parsedSheets: string[] = [];
  const skippedSheets: string[] = [];
  let ignoredRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: true,
    });
    const header = findHeaderRow(rows);

    if (!header) {
      skippedSheets.push(sheetName);
      continue;
    }

    parsedSheets.push(sheetName);
    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const rawItemType = row[header.itemTypeIndex];
      const itemType = String(rawItemType ?? "").trim();
      const primaryValue = row[header.imeiIndex];
      const orderRef =
        header.orderRefIndex >= 0
          ? String(row[header.orderRefIndex] ?? "").trim()
          : "";
      const companionValue =
        header.companionIndex >= 0 ? row[header.companionIndex] : "";
      const source = { sheet: sheetName, row: rowIndex + 1 };

      if (!itemType) {
        if (parseImei(primaryValue) || parseImei(companionValue)) {
          errors.push({
            ...source,
            message: "An IMEI is present but Item Type is empty.",
          });
        }
        continue;
      }

      const deviceKind = classifyDevice(itemType);
      if (deviceKind) {
        const primaryImei = parseImei(primaryValue);
        const companionImei = parseImei(companionValue);

        if (!primaryImei) {
          errors.push({
            ...source,
            itemType,
            message: `Device ${itemType} does not contain a valid 15-digit IMEI / ID.`,
          });
        }

        deviceRows.push({
          ...source,
          deviceKind,
          itemType,
          primaryImei,
          companionImei,
        });
        continue;
      }

      ignoredRows += 1;
      const nonDeviceKind = classifyNonDevice(itemType);
      if (nonDeviceKind) {
        ignoredItemTypes.add(itemType);
        if (nonDeviceKind === "accessory") {
          accessoryRows.push({
            ...source,
            orderRef,
            itemType,
            linkedImei: parseImei(primaryValue),
          });
        }
      } else {
        unknownItemTypes.add(itemType);
        errors.push({
          ...source,
          itemType,
          message: `Unknown Item Type \"${itemType}\". The report was not confirmed automatically to avoid missing a device.`,
        });
      }
    }
  }

  if (parsedSheets.length === 0) {
    errors.push({
      sheet: workbook.SheetNames[0] || "Workbook",
      row: 1,
      message: "No worksheet contains the required Item Type and IMEI / ID headers.",
    });
  }

  const primaryDeviceCounts = new Map<string, number>();
  for (const row of deviceRows) {
    if (!row.primaryImei) continue;
    primaryDeviceCounts.set(
      row.primaryImei,
      (primaryDeviceCounts.get(row.primaryImei) || 0) + 1
    );
  }

  const selected: EndOfDayDeviceRow[] = [];
  for (const row of deviceRows) {
    if (!row.primaryImei) continue;

    const linkedDvr =
      isDvr(row.deviceKind) &&
      (primaryDeviceCounts.get(row.primaryImei) || 0) > 1;

    if (linkedDvr) {
      if (!row.companionImei) {
        errors.push({
          sheet: row.sheet,
          row: row.row,
          itemType: row.itemType,
          message: `DVR is linked through IMEI ${row.primaryImei}, but Companion Device IMEI is missing or invalid.`,
        });
        continue;
      }

      selected.push({
        sheet: row.sheet,
        row: row.row,
        itemType: row.itemType,
        deviceKind: row.deviceKind,
        primaryImei: row.primaryImei,
        companionImei: row.companionImei,
        imei: row.companionImei,
        linkedDvr: true,
      });
      continue;
    }

    selected.push({
      sheet: row.sheet,
      row: row.row,
      itemType: row.itemType,
      deviceKind: row.deviceKind,
      primaryImei: row.primaryImei,
      companionImei: row.companionImei,
      imei: row.primaryImei,
      linkedDvr: false,
    });
  }

  const selectedByImei = new Map<string, SourceLocation[]>();
  for (const row of selected) {
    const locations = selectedByImei.get(row.imei) || [];
    locations.push({ sheet: row.sheet, row: row.row });
    selectedByImei.set(row.imei, locations);
  }

  const duplicates = Array.from(selectedByImei.entries())
    .filter(([, locations]) => locations.length > 1)
    .map(([imei, locations]) => ({
      imei,
      count: locations.length,
      locations,
    }));

  if (deviceRows.length === 0 && parsedSheets.length > 0) {
    errors.push({
      sheet: parsedSheets[0],
      row: 1,
      message: "No supported device rows were found in the workbook.",
    });
  }

  return {
    imeis: selected.map((row) => row.imei),
    duplicates,
    errors,
    ignoredRows,
    ignoredItemTypes: Array.from(ignoredItemTypes).sort(),
    unknownItemTypes: Array.from(unknownItemTypes).sort(),
    parsedSheets,
    skippedSheets,
    deviceRows: deviceRows.length,
    devices: selected,
    accessories: accessoryRows,
  };
}
