import * as XLSX from "xlsx";
import {
  dispatchPackagingRuleExtras,
  type DispatchPackagingRule,
} from "./dispatch-packaging-rules";
import { isPackagingContainer } from "./packaging";

export const DISPATCH_PACKING_FACTOR = 1.15;

export type DispatchDimensions = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export type DispatchCatalogItem = DispatchDimensions & {
  name: string;
};

export type DispatchSourceLine = {
  sheet: string;
  row: number;
  orderId: string;
  orderLineId: string;
  vehicleRegistration: string;
  hardwareType: string;
  deviceType: string;
  deviceModel: string | null;
  isDevice: boolean;
  mappedItem: string;
  additionalMappedItems: string[];
  destinationCountry: string;
  companyName: string;
};

export type DispatchOrderItem = DispatchCatalogItem & {
  sourceItem: string;
  quantity: number;
  workbookQuantity: number;
  automaticQuantity: number;
  unitVolumeCm3: number;
  totalVolumeCm3: number;
};

export type DispatchOrder = {
  orderId: string;
  destinationCountry: string;
  companyName: string;
  lineCount: number;
  totalVolumeCm3: number;
  adjustedVolumeCm3: number;
  deviceCounts: Record<string, number>;
  items: DispatchOrderItem[];
};

export type DispatchAutomaticAccessoryRule = {
  deviceModel: string;
  accessoryName: string;
  quantity: number;
  perDevices: number;
};

export type DispatchParseIssue = {
  sheet: string;
  row: number;
  message: string;
  hardwareType?: string;
  deviceType?: string;
  // Name to register in the dispatch item catalog to resolve this row.
  suggestedName?: string | null;
};

export type DispatchParseResult = {
  orders: DispatchOrder[];
  lines: DispatchSourceLine[];
  issues: DispatchParseIssue[];
  parsedSheets: string[];
  skippedSheets: string[];
  generatedAt: string | null;
};

export type PackagingOption = DispatchDimensions & {
  id: string;
  code: string;
  name: string;
  category: string;
  onHandStock: number;
  reservedStock: number;
  active: boolean;
};

export type DispatchPackageAllocation = {
  packagingTypeId: string;
  code: string;
  name: string;
  quantity: number;
  unitVolumeCm3: number;
  source?: "calculated" | "learned" | "manual" | "rule";
  learningCount?: number;
};

export type PlannedDispatchOrder = DispatchOrder & {
  packages: DispatchPackageAllocation[];
  // Sleeves and other packaging added by automatic packaging rules.
  extras?: DispatchPackageAllocation[];
};

export type DispatchPackageUsage = DispatchPackageAllocation & {
  onHandStock: number;
  reservedStock: number;
  availableStock: number;
  stockAfter: number;
};

export type DispatchPlan = {
  orders: PlannedDispatchOrder[];
  packageUsage: DispatchPackageUsage[];
  blockers: string[];
  totalPackages: number;
};

export type DispatchPickingInventoryRow = {
  name: string;
  availableStock: number;
};

export type DispatchPickingSummaryRow = {
  category: "device" | "accessory" | "packaging";
  name: string;
  requiredQuantity: number;
  availableStock: number | null;
  difference: number | null;
  status: "available" | "shortage" | "not_configured";
  orderIds: string[];
};

export type DispatchPackagingSelection = {
  orderId: string;
  packagingTypeId: string;
  quantity: number;
  source?: "calculated" | "learned" | "manual";
  learningCount?: number;
};

function pickingInventoryByCatalogKey(
  rows: DispatchPickingInventoryRow[],
  category: "device" | "accessory",
  catalog: DispatchCatalog
) {
  const inventory = new Map<string, number>();
  for (const row of rows) {
    const catalogName =
      (category === "device" ? resolveDispatchDeviceModel(row.name) : null) ||
      resolveDispatchCatalogItem(row.name, "", catalog)?.name ||
      row.name;
    const key = dispatchItemKey(catalogName);
    inventory.set(
      key,
      (inventory.get(key) || 0) + Math.max(0, Number(row.availableStock || 0))
    );
  }
  return inventory;
}

export function buildDispatchPickingSummary(
  orders: PlannedDispatchOrder[],
  packageUsage: DispatchPackageUsage[],
  deviceInventory: DispatchPickingInventoryRow[],
  accessoryInventory: DispatchPickingInventoryRow[],
  catalog: DispatchCatalog = DEFAULT_DISPATCH_CATALOG
) {
  const deviceStock = pickingInventoryByCatalogKey(
    deviceInventory,
    "device",
    catalog
  );
  const accessoryStock = pickingInventoryByCatalogKey(
    accessoryInventory,
    "accessory",
    catalog
  );
  const packageStock = new Map(
    packageUsage.map((usage) => [
      String(usage.packagingTypeId),
      Number(usage.availableStock || 0),
    ])
  );
  const summary = new Map<
    string,
    {
      category: DispatchPickingSummaryRow["category"];
      name: string;
      requiredQuantity: number;
      availableStock: number | null;
      orderIds: Set<string>;
    }
  >();

  const add = (
    category: DispatchPickingSummaryRow["category"],
    name: string,
    quantity: number,
    availableStock: number | null,
    orderId: string,
    identity = dispatchItemKey(name)
  ) => {
    const key = `${category}:${identity}`;
    const current = summary.get(key);
    if (current) {
      current.requiredQuantity += quantity;
      current.orderIds.add(orderId);
      return;
    }
    summary.set(key, {
      category,
      name,
      requiredQuantity: quantity,
      availableStock,
      orderIds: new Set([orderId]),
    });
  };

  for (const order of orders) {
    const deviceKeys = new Set(
      Object.keys(order.deviceCounts || {}).map(dispatchItemKey)
    );
    for (const [device, quantity] of Object.entries(order.deviceCounts || {})) {
      const key = dispatchItemKey(device);
      add(
        "device",
        device,
        Number(quantity || 0),
        deviceStock.get(key) ?? null,
        order.orderId,
        key
      );
    }

    for (const item of order.items) {
      const key = dispatchItemKey(item.name);
      if (deviceKeys.has(key)) continue;
      add(
        "accessory",
        item.name,
        Number(item.quantity || 0),
        accessoryStock.get(key) ?? null,
        order.orderId,
        key
      );
    }

    for (const packaging of [...(order.packages || []), ...(order.extras || [])]) {
      add(
        "packaging",
        packaging.name,
        Number(packaging.quantity || 0),
        packageStock.get(String(packaging.packagingTypeId)) ?? null,
        order.orderId,
        String(packaging.packagingTypeId)
      );
    }
  }

  const categoryOrder = { device: 0, accessory: 1, packaging: 2 } as const;
  return Array.from(summary.values())
    .map<DispatchPickingSummaryRow>((row) => {
      const difference =
        row.availableStock === null
          ? null
          : row.availableStock - row.requiredQuantity;
      return {
        ...row,
        difference,
        status:
          difference === null
            ? "not_configured"
            : difference < 0
              ? "shortage"
              : "available",
        orderIds: Array.from(row.orderIds).sort((left, right) =>
          left.localeCompare(right, undefined, { numeric: true })
        ),
      };
    })
    .sort(
      (left, right) =>
        categoryOrder[left.category] - categoryOrder[right.category] ||
        left.name.localeCompare(right.name)
    );
}

export type DispatchCatalogEntry = DispatchCatalogItem & {
  // Labels that always point to this item (Kinesis names).
  aliases: string[];
  // Labels used only when no other item claims them (inventory record names).
  weakAliases?: string[];
};

export type DispatchCatalog = {
  entries: DispatchCatalogEntry[];
  byKey: Map<string, DispatchCatalogItem>;
};

// Dimensions built into the application. Device Bins and Accessory Inventory
// records with dimensions take precedence; this list is the safety net for
// records without dimensions and for databases without the dimension columns.
export const BUILT_IN_DISPATCH_CATALOG: DispatchCatalogEntry[] = [
  { name: "10M AV Extension Cable", lengthCm: 13, widthCm: 13, heightCm: 3, aliases: [] },
  { name: "3M AV Extension Cable", lengthCm: 13, widthCm: 4, heightCm: 4, aliases: [] },
  { name: "Camera - Front Facing", lengthCm: 9.5, widthCm: 9.5, heightCm: 12, aliases: [] },
  { name: "Camera - Rear/Bracket Mounted", lengthCm: 10, widthCm: 9, heightCm: 9, aliases: [] },
  { name: "DVR - 2 Channel -  (N+)", lengthCm: 20, widthCm: 18, heightCm: 7, aliases: [] },
  { name: "Storage - 256GB SD Card", lengthCm: 2.2, widthCm: 3, heightCm: 0.2, aliases: [] },
  { name: "BUZZER", lengthCm: 2, widthCm: 4, heightCm: 4, aliases: [] },
  { name: "CV200 Bullet Camera", lengthCm: 5, widthCm: 3, heightCm: 6, aliases: [] },
  { name: "FMB130 connectorized harness", lengthCm: 1.5, widthCm: 7, heightCm: 7, aliases: ["FMB130 connectorized harness 22"] },
  { name: "FMB140 connectorized harness", lengthCm: 1.5, widthCm: 7, heightCm: 7, aliases: ["FMB140 connectorized harness 23"] },
  { name: "3 amp Fuse mini blade", lengthCm: 1.5, widthCm: 1.5, heightCm: 0.3, aliases: ["3 amp Fuse mini blade 11"] },
  { name: "Fuse Holder - mini blade in-line", lengthCm: 10.5, widthCm: 2, heightCm: 0.3, aliases: ["Fuse Holder - mini blade in-line 10"] },
  { name: "Teltonika Contactless CAN - ECAN02", lengthCm: 2, widthCm: 9, heightCm: 2, aliases: ["ECAN02"] },
  { name: "FOB", lengthCm: 5, widthCm: 2, heightCm: 2, aliases: [] },
  { name: "OBD Cable", lengthCm: 1.5, widthCm: 13, heightCm: 11, aliases: ["OBD Cable FMC003"] },
  { name: "HARDWIRED Cable for", lengthCm: 14, widthCm: 5, heightCm: 5, aliases: ["HARDWIRED Cable for CV200"] },
  { name: "READER", lengthCm: 11, widthCm: 7, heightCm: 0.5, aliases: [] },
  { name: "Atom Install Guide", lengthCm: 5.5, widthCm: 8.3, heightCm: 0.1, aliases: ["Atom Install Guide TBD001"] },
  { name: "Atom Adhesive Pad", lengthCm: 5, widthCm: 8, heightCm: 0.2, aliases: ["Atom Adhesive Pad FMC880"] },
  { name: "Barra Adhesive Pad", lengthCm: 14.5, widthCm: 4.5, heightCm: 0.2, aliases: ["Barra Adhesive Pad BAP01"] },
  { name: "CV200 Adhesive Pad", lengthCm: 7, widthCm: 5, heightCm: 0.2, aliases: ["CV200 adhesive pad CVAP", "CV200 Adhesive Pad CVAP01"] },
  { name: "Tachograph T-Harness", lengthCm: 16, widthCm: 12, heightCm: 2, aliases: ["Tachograph T-Harness Tacho-T-harness"] },
  { name: "WIPE", lengthCm: 6.5, widthCm: 7.5, heightCm: 0.3, aliases: ["WIPE TBD011"] },
  // The official volume workbook intentionally has no dimensions for these
  // flexible consumables. They remain visible in the packing list but add no
  // incremental box volume because they fit around the device contents.
  { name: "Large Cable Ties", lengthCm: 0, widthCm: 0, heightCm: 0, aliases: ["Large Cable Ties 25"] },
  { name: "NEON-T Adhesive Pads", lengthCm: 0, widthCm: 0, heightCm: 0, aliases: ["NEON-T Adhesive Pads 24"] },
  { name: "T7 Adhesive pad", lengthCm: 0, widthCm: 0, heightCm: 0, aliases: ["T7 Adhesive pad T7Pad"] },
  { name: "CNHYCV200XEU", lengthCm: 9, widthCm: 20, heightCm: 23.5, aliases: ["AIO Camera", "CV200XEU", "CV200XEU-256"] },
  { name: "BarraGps", lengthCm: 2.5, widthCm: 5.5, heightCm: 16, aliases: ["Barra-GPS"] },
  { name: "FMC003", lengthCm: 2.5, widthCm: 5, heightCm: 7, aliases: [] },
  { name: "FMC130", lengthCm: 6.4, widthCm: 5.5, heightCm: 2, aliases: [] },
  { name: "FMC234", lengthCm: 15, widthCm: 11, heightCm: 3, aliases: [] },
  { name: "FMC650", lengthCm: 10, widthCm: 7, heightCm: 3, aliases: [] },
  { name: "FMC920", lengthCm: 4, widthCm: 8, heightCm: 2, aliases: [] },
  { name: "FMB140", lengthCm: 6.4, widthCm: 5.5, heightCm: 2, aliases: [] },
  { name: "FMC880", lengthCm: 6, widthCm: 9, heightCm: 1.5, aliases: [] },
  { name: "Howen2CH", lengthCm: 20, widthCm: 18, heightCm: 7, aliases: ["DVR-2CH"] },
  { name: "Neon-P", lengthCm: 8, widthCm: 7, heightCm: 3.5, aliases: [] },
  { name: "Neon-R", lengthCm: 8, widthCm: 7, heightCm: 3, aliases: [] },
  { name: "Howen8CH", lengthCm: 25, widthCm: 24, heightCm: 15, aliases: ["DVR-8CH"] },
  { name: "Howen4CH", lengthCm: 25, widthCm: 24, heightCm: 15, aliases: ["DVR-4CH"] },
];

// Hardware Types whose physical item is identified by the Device Type column.
export const DEVICE_TYPE_HARDWARE_KEYS = [
  "atom",
  "hardwired",
  "neon",
  "obd",
  "trailer",
] as const;

function normalized(value: unknown) {
  return String(value ?? "")
    .replace(/^\s*\*+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dispatchItemKey(value: unknown) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Labels are claimed in priority order: inventory names and Kinesis names,
// then inventory record names, then the built-in list.
export function createDispatchCatalog(
  entries: DispatchCatalogEntry[],
  fallbackEntries: DispatchCatalogEntry[] = []
): DispatchCatalog {
  const byKey = new Map<string, DispatchCatalogItem>();
  const claim = (entry: DispatchCatalogEntry, labels: string[]) => {
    const item: DispatchCatalogItem = {
      name: entry.name,
      lengthCm: entry.lengthCm,
      widthCm: entry.widthCm,
      heightCm: entry.heightCm,
    };
    for (const label of labels) {
      const key = dispatchItemKey(label);
      if (key && !byKey.has(key)) byKey.set(key, item);
    }
  };
  for (const entry of entries) claim(entry, [entry.name, ...entry.aliases]);
  for (const entry of entries) claim(entry, entry.weakAliases ?? []);
  for (const entry of fallbackEntries) claim(entry, [entry.name, ...entry.aliases]);
  return { entries: [...entries, ...fallbackEntries], byKey };
}

export const DEFAULT_DISPATCH_CATALOG = createDispatchCatalog(
  [],
  BUILT_IN_DISPATCH_CATALOG
);

// Accessory records carry a product code after the label, e.g.
// "BUZZER<tab>4" or "*Camera - Front Facing PRO895".
export function inventoryBaseName(rawName: string) {
  const beforeTab = String(rawName ?? "").split("\t")[0];
  return normalized(beforeTab).replace(/\s+(?:PRO|TBD)\d+$/i, "").trim();
}

export type DispatchInventoryRecord = {
  name: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  kinesisNames: string[];
};

function hasDimensions(record: DispatchInventoryRecord) {
  return [record.lengthCm, record.widthCm, record.heightCm].every(
    (value) => value !== null && Number.isFinite(value)
  );
}

// Device models keep their bin name, which is also the device model used in
// device counts and automatic accessory rules.
export function dispatchEntryFromDevice(
  record: DispatchInventoryRecord
): DispatchCatalogEntry | null {
  if (!hasDimensions(record)) return null;
  return {
    name: normalized(record.name),
    lengthCm: Number(record.lengthCm),
    widthCm: Number(record.widthCm),
    heightCm: Number(record.heightCm),
    aliases: record.kinesisNames,
  };
}

// Accessories are named after their first Kinesis name so packing lists and
// learned packaging keep the labels Kinesis uses.
export function dispatchEntryFromAccessory(
  record: DispatchInventoryRecord
): DispatchCatalogEntry | null {
  if (!hasDimensions(record)) return null;
  const baseName = inventoryBaseName(record.name);
  return {
    name: normalized(record.kinesisNames[0] || baseName || record.name),
    lengthCm: Number(record.lengthCm),
    widthCm: Number(record.widthCm),
    heightCm: Number(record.heightCm),
    aliases: record.kinesisNames,
    weakAliases: [record.name, baseName],
  };
}

export function createInventoryDispatchCatalog(
  devices: DispatchInventoryRecord[],
  accessories: DispatchInventoryRecord[]
) {
  const entries = [
    ...devices.map(dispatchEntryFromDevice),
    ...accessories.map(dispatchEntryFromAccessory),
  ].filter((entry): entry is DispatchCatalogEntry => entry !== null);
  return createDispatchCatalog(entries, BUILT_IN_DISPATCH_CATALOG);
}

function isEcan02DeviceBundle(value: unknown) {
  const key = dispatchItemKey(value);
  return key.includes("contactlesscan") && key.includes("ecan02");
}

function isDeviceTypeHardware(hardwareKey: string) {
  return (DEVICE_TYPE_HARDWARE_KEYS as readonly string[]).includes(hardwareKey);
}

// Kinesis sometimes writes DVRs in short form, e.g. "DVR-4CH".
function dvrShorthandModel(hardwareKey: string) {
  const match = hardwareKey.match(/^dvr([248])(?:ch|channel)n?$/);
  return match ? `Howen${match[1]}CH` : null;
}

export function isDispatchVolumeAccessoryCategory(category: unknown) {
  return dispatchItemKey(category) !== "packages";
}

export function resolveDispatchDeviceModel(value: string) {
  const normalizedValue = value.toUpperCase();
  const patterns: Array<[RegExp, string]> = [
    [/CV200XEU|CNHYCV200/, "CNHYCV200XEU"],
    [/BARRA[\s-]?GPS/, "BarraGps"],
    [/FMC003/, "FMC003"],
    [/FM[BC]130/, "FMC130"],
    [/FMC234/, "FMC234"],
    [/FMC650/, "FMC650"],
    [/FMC920/, "FMC920"],
    [/FMB140/, "FMB140"],
    [/FMC880/, "FMC880"],
    [/HOWEN[^A-Z0-9]*2\s*CH|DVR[^A-Z0-9]*2\s*CHANNEL/, "Howen2CH"],
    [/HOWEN[^A-Z0-9]*4\s*CH|DVR[^A-Z0-9]*4\s*CHANNEL/, "Howen4CH"],
    [/HOWEN[^A-Z0-9]*8\s*CH|DVR[^A-Z0-9]*8\s*CHANNEL/, "Howen8CH"],
    [/NEON[\s-]?P|\bT1\b/, "Neon-P"],
    [/NEON[\s-]?R|\bT7LTE\b/, "Neon-R"],
  ];
  return patterns.find(([pattern]) => pattern.test(normalizedValue))?.[1] ?? null;
}

// Device models added in the app are found in the "Brand - Family - Model"
// Device Type text, starting from the most specific segment.
function catalogDeviceModel(deviceType: string, catalog: DispatchCatalog) {
  const segments = normalized(deviceType).split(/\s+-\s+/).reverse();
  for (const segment of segments) {
    const item = catalog.byKey.get(dispatchItemKey(segment));
    if (item) return item.name;
  }
  return null;
}

function deviceModelFromType(deviceType: string, catalog: DispatchCatalog) {
  return (
    resolveDispatchDeviceModel(deviceType) ??
    catalogDeviceModel(deviceType, catalog)
  );
}

export function resolveDispatchCatalogItem(
  hardwareType: string,
  deviceType: string,
  catalog: DispatchCatalog = DEFAULT_DISPATCH_CATALOG
) {
  const cleanHardware = normalized(hardwareType);
  const hardwareKey = dispatchItemKey(cleanHardware);
  const byName = (name: string) =>
    catalog.byKey.get(dispatchItemKey(name)) ?? null;

  if (hardwareKey === "aiocamera") {
    return byName("CNHYCV200XEU");
  }

  if (isEcan02DeviceBundle(cleanHardware)) {
    const model = resolveDispatchDeviceModel(deviceType);
    return model === "FMB140" ? byName(model) : null;
  }

  // Kinesis exports the FMC650 tachograph harness under the generic label
  // "HARNESS". Keep this contextual so unrelated generic harness rows do not
  // inherit dimensions that may not match their physical item.
  if (
    hardwareKey === "harness" &&
    resolveDispatchDeviceModel(deviceType) === "FMC650"
  ) {
    return byName("Tachograph T-Harness");
  }

  if (isDeviceTypeHardware(hardwareKey)) {
    const model = deviceModelFromType(deviceType, catalog);
    return model ? byName(model) : null;
  }

  const exact = catalog.byKey.get(hardwareKey);
  if (exact) return exact;

  const dvrModel = dvrShorthandModel(hardwareKey);
  return dvrModel ? byName(dvrModel) : null;
}

export function resolveDispatchLineDeviceModel(
  hardwareType: string,
  deviceType: string,
  mappedItem?: string,
  catalog: DispatchCatalog = DEFAULT_DISPATCH_CATALOG
) {
  const hardwareKey = dispatchItemKey(hardwareType);
  if (hardwareKey === "aiocamera") return "CNHYCV200XEU";
  if (isEcan02DeviceBundle(hardwareType)) {
    return resolveDispatchDeviceModel(deviceType) === "FMB140"
      ? "FMB140"
      : null;
  }
  if (isDeviceTypeHardware(hardwareKey)) {
    return deviceModelFromType(deviceType, catalog);
  }
  if (hardwareKey.startsWith("dvr")) {
    const shorthand = dvrShorthandModel(hardwareKey);
    if (shorthand) return shorthand;
    if (/dvr.*2channel/.test(hardwareKey)) return "Howen2CH";
    if (/dvr.*4channel/.test(hardwareKey)) return "Howen4CH";
    if (/dvr.*8channel/.test(hardwareKey)) return "Howen8CH";
    const item =
      mappedItem ||
      resolveDispatchCatalogItem(hardwareType, deviceType, catalog)?.name;
    return item && /^Howen(?:2|4|8)CH$/i.test(item) ? item : null;
  }
  return null;
}

// The catalog name that would resolve an unknown row, or null when the row
// cannot be fixed by adding dimensions (for example an incomplete bundle).
export function dispatchCatalogSuggestion(
  hardwareType: string,
  deviceType: string
) {
  const hardwareKey = dispatchItemKey(hardwareType);
  if (!hardwareKey || hardwareKey === "aiocamera" || isEcan02DeviceBundle(hardwareType)) {
    return null;
  }
  if (isDeviceTypeHardware(hardwareKey)) {
    const segments = normalized(deviceType).split(/\s+-\s+/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }
  return normalized(hardwareType);
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return normalized(value);
}

function headerIndex(row: unknown[]) {
  const map = new Map(
    row.map((value, index) => [dispatchItemKey(value), index])
  );
  if (!map.has("orderid") || !map.has("hardwaretype")) return null;
  return map;
}

function generatedAtFromRows(rows: unknown[][]) {
  for (const row of rows.slice(0, 5)) {
    const joined = row.map(cellText).join(" ");
    const match = joined.match(/(?:Report Generated|Generated Date)\s*:\s*(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function parseDispatchWorkbook(
  workbook: XLSX.WorkBook,
  catalog: DispatchCatalog = DEFAULT_DISPATCH_CATALOG
): DispatchParseResult {
  const lines: DispatchSourceLine[] = [];
  const issues: DispatchParseIssue[] = [];
  const parsedSheets: string[] = [];
  const skippedSheets: string[] = [];
  let generatedAt: string | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = (sheet
      ? (XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          defval: "",
        }) as unknown[][])
      : []) as unknown[][];
    const headerRowIndex = rows.findIndex((row) => headerIndex(row));
    if (headerRowIndex < 0) {
      skippedSheets.push(sheetName);
      continue;
    }

    const indexes = headerIndex(rows[headerRowIndex])!;
    const indexOf = (name: string) => indexes.get(dispatchItemKey(name));
    parsedSheets.push(sheetName);
    generatedAt ||= generatedAtFromRows(rows);

    for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
      const row = rows[index];
      const value = (name: string) => {
        const cellIndex = indexOf(name);
        return cellIndex === undefined ? "" : cellText(row[cellIndex]);
      };
      const orderId = value("Order ID");
      const hardwareType = value("Hardware Type");
      const deviceType = value("Device Type");

      if (!orderId && !hardwareType && !deviceType) continue;
      // Kinesis Insights is a software licence exported alongside the
      // physical order contents. It must not affect packing volume or block
      // an otherwise valid vehicle order.
      if (dispatchItemKey(hardwareType) === "kinesisinsights") continue;
      if (!orderId || !hardwareType) {
        issues.push({
          sheet: sheetName,
          row: index + 1,
          message: "Order ID and Hardware Type are required.",
          hardwareType,
          deviceType,
        });
        continue;
      }

      const catalogItem = resolveDispatchCatalogItem(
        hardwareType,
        deviceType,
        catalog
      );
      if (!catalogItem) {
        issues.push({
          sheet: sheetName,
          row: index + 1,
          message: "No trusted dimensions match this hardware/device combination.",
          hardwareType,
          deviceType,
          suggestedName: dispatchCatalogSuggestion(hardwareType, deviceType),
        });
        continue;
      }

      const deviceModel = resolveDispatchLineDeviceModel(
        hardwareType,
        deviceType,
        catalogItem.name,
        catalog
      );

      lines.push({
        sheet: sheetName,
        row: index + 1,
        orderId,
        orderLineId: value("Order Line ID"),
        vehicleRegistration: value("Vehicle Registration"),
        hardwareType: normalized(hardwareType),
        deviceType: normalized(deviceType),
        deviceModel,
        isDevice: Boolean(deviceModel),
        mappedItem: catalogItem.name,
        additionalMappedItems: isEcan02DeviceBundle(hardwareType)
          ? ["Teltonika Contactless CAN - ECAN02"]
          : [],
        destinationCountry: value("Destination Country"),
        companyName: value("Company Name"),
      });
    }
  }

  const byOrder = new Map<string, DispatchSourceLine[]>();
  for (const line of lines) {
    byOrder.set(line.orderId, [...(byOrder.get(line.orderId) ?? []), line]);
  }

  const orders: DispatchOrder[] = Array.from(byOrder.entries()).map(
    ([orderId, orderLines]) => {
      const groupedItems = new Map<string, DispatchSourceLine[]>();
      for (const line of orderLines) {
        for (const mappedItem of [
          line.mappedItem,
          ...line.additionalMappedItems,
        ]) {
          groupedItems.set(mappedItem, [
            ...(groupedItems.get(mappedItem) ?? []),
            line,
          ]);
        }
      }

      const items = Array.from(groupedItems.entries()).map(
        ([mappedItem, itemLines]) => {
          const catalogItem = catalog.byKey.get(dispatchItemKey(mappedItem))!;
          const unitVolumeCm3 =
            catalogItem.lengthCm * catalogItem.widthCm * catalogItem.heightCm;
          return {
            ...catalogItem,
            sourceItem: itemLines[0].hardwareType,
            quantity: itemLines.length,
            workbookQuantity: itemLines.length,
            automaticQuantity: 0,
            unitVolumeCm3,
            totalVolumeCm3: unitVolumeCm3 * itemLines.length,
          };
        }
      );
      const totalVolumeCm3 = items.reduce(
        (total, item) => total + item.totalVolumeCm3,
        0
      );
      const deviceCounts = orderLines.reduce<Record<string, number>>(
        (counts, line) => {
          if (!line.isDevice || !line.deviceModel) return counts;
          counts[line.deviceModel] = (counts[line.deviceModel] || 0) + 1;
          return counts;
        },
        {}
      );

      return {
        orderId,
        destinationCountry:
          orderLines.find((line) => line.destinationCountry)?.destinationCountry ?? "",
        companyName:
          orderLines.find((line) => line.companyName)?.companyName ?? "",
        lineCount: orderLines.length,
        totalVolumeCm3,
        adjustedVolumeCm3: totalVolumeCm3 * DISPATCH_PACKING_FACTOR,
        deviceCounts,
        items,
      };
    }
  );

  orders.sort((a, b) => a.orderId.localeCompare(b.orderId, undefined, { numeric: true }));

  if (parsedSheets.length === 0) {
    issues.push({
      sheet: workbook.SheetNames[0] ?? "Workbook",
      row: 1,
      message: "No sheet contains the required Order ID and Hardware Type columns.",
    });
  } else if (lines.length === 0 && issues.length === 0) {
    issues.push({
      sheet: parsedSheets[0],
      row: 1,
      message: "No dispatch order lines were found.",
    });
  }

  return { orders, lines, issues, parsedSheets, skippedSheets, generatedAt };
}

export function applyDispatchAutomaticAccessoryRules(
  orders: DispatchOrder[],
  rules: DispatchAutomaticAccessoryRule[],
  catalog: DispatchCatalog = DEFAULT_DISPATCH_CATALOG
) {
  const issues: DispatchParseIssue[] = [];
  const enrichedOrders = orders.map((order) => {
    const expectedByAccessory = new Map<
      string,
      { catalogItem: DispatchCatalogItem; expected: number; accessoryName: string }
    >();

    for (const rule of rules) {
      const deviceCount = Object.entries(order.deviceCounts || {}).find(
        ([model]) =>
          dispatchItemKey(model) === dispatchItemKey(rule.deviceModel)
      )?.[1];
      if (!deviceCount) continue;

      if (
        !Number.isSafeInteger(rule.quantity) ||
        rule.quantity <= 0 ||
        !Number.isSafeInteger(rule.perDevices) ||
        rule.perDevices <= 0
      ) {
        issues.push({
          sheet: "Automatic accessory rules",
          row: 1,
          message: `The automatic accessory rule for ${rule.deviceModel} has an invalid quantity.`,
          deviceType: rule.deviceModel,
        });
        continue;
      }

      const catalogItem = resolveDispatchCatalogItem(
        rule.accessoryName,
        "",
        catalog
      );
      if (!catalogItem) {
        issues.push({
          sheet: "Automatic accessory rules",
          row: 1,
          message: `Automatic accessory ${rule.accessoryName} for ${rule.deviceModel} has no trusted dimensions.`,
          hardwareType: rule.accessoryName,
          deviceType: rule.deviceModel,
          suggestedName: rule.accessoryName,
        });
        continue;
      }

      const accessoryKey = dispatchItemKey(catalogItem.name);
      const current = expectedByAccessory.get(accessoryKey);
      expectedByAccessory.set(accessoryKey, {
        catalogItem,
        accessoryName: rule.accessoryName,
        expected:
          (current?.expected || 0) +
          Math.ceil(deviceCount / rule.perDevices) * rule.quantity,
      });
    }

    const items = order.items.map((item) => ({ ...item }));
    for (const [accessoryKey, expected] of expectedByAccessory) {
      const existingIndex = items.findIndex(
        (item) => dispatchItemKey(item.name) === accessoryKey
      );
      const existingQuantity =
        existingIndex >= 0 ? Number(items[existingIndex].quantity || 0) : 0;
      const automaticQuantity = Math.max(0, expected.expected - existingQuantity);
      if (automaticQuantity === 0) continue;

      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        const quantity = existingQuantity + automaticQuantity;
        items[existingIndex] = {
          ...existing,
          quantity,
          workbookQuantity:
            existing.workbookQuantity ?? existingQuantity,
          automaticQuantity:
            Number(existing.automaticQuantity || 0) + automaticQuantity,
          totalVolumeCm3: existing.unitVolumeCm3 * quantity,
        };
      } else {
        const unitVolumeCm3 =
          expected.catalogItem.lengthCm *
          expected.catalogItem.widthCm *
          expected.catalogItem.heightCm;
        items.push({
          ...expected.catalogItem,
          sourceItem: expected.accessoryName,
          quantity: automaticQuantity,
          workbookQuantity: 0,
          automaticQuantity,
          unitVolumeCm3,
          totalVolumeCm3: unitVolumeCm3 * automaticQuantity,
        });
      }
    }

    items.sort((left, right) => left.name.localeCompare(right.name));
    const totalVolumeCm3 = items.reduce(
      (total, item) => total + item.totalVolumeCm3,
      0
    );
    return {
      ...order,
      items,
      totalVolumeCm3,
      adjustedVolumeCm3: totalVolumeCm3 * DISPATCH_PACKING_FACTOR,
    };
  });

  return { orders: enrichedOrders, issues };
}

function sortedDimensions(value: DispatchDimensions) {
  return [value.lengthCm, value.widthCm, value.heightCm].sort((a, b) => a - b);
}

export function itemFitsPackage(
  item: DispatchDimensions,
  packaging: DispatchDimensions
) {
  const itemDimensions = sortedDimensions(item);
  const packageDimensions = sortedDimensions(packaging);
  return itemDimensions.every(
    (dimension, index) => dimension <= packageDimensions[index]
  );
}

export function planDispatchPackaging(
  orders: DispatchOrder[],
  packages: PackagingOption[],
  rules: DispatchPackagingRule[] = []
): DispatchPlan {
  const activePackages = packages.filter(
    (packaging) => packaging.active && isPackagingContainer(packaging.category)
  );
  const plannedOrders: PlannedDispatchOrder[] = [];
  const blockers: string[] = [];

  for (const order of orders) {
    const candidates = activePackages
      .filter((packaging) =>
        order.items.every((item) => itemFitsPackage(item, packaging))
      )
      .map((packaging) => {
        const unitVolumeCm3 =
          packaging.lengthCm * packaging.widthCm * packaging.heightCm;
        const quantity = Math.max(
          1,
          Math.ceil(order.adjustedVolumeCm3 / unitVolumeCm3)
        );
        return { packaging, unitVolumeCm3, quantity };
      })
      .sort(
        (a, b) =>
          a.quantity - b.quantity ||
          a.quantity * a.unitVolumeCm3 - b.quantity * b.unitVolumeCm3 ||
          a.unitVolumeCm3 - b.unitVolumeCm3
      );

    const selected = candidates[0];
    if (!selected) {
      blockers.push(
        `Order ${order.orderId}: no active packaging format can fit every item.`
      );
      plannedOrders.push({ ...order, packages: [] });
      continue;
    }

    plannedOrders.push({
      ...order,
      packages: [
        {
          packagingTypeId: selected.packaging.id,
          code: selected.packaging.code,
          name: selected.packaging.name,
          quantity: selected.quantity,
          unitVolumeCm3: selected.unitVolumeCm3,
          source: "calculated",
        },
      ],
    });
  }

  return summarizeDispatchPackaging(
    withPackagingRuleExtras(plannedOrders, packages, rules, blockers),
    packages,
    blockers
  );
}

function withPackagingRuleExtras(
  orders: PlannedDispatchOrder[],
  packages: PackagingOption[],
  rules: DispatchPackagingRule[],
  blockers: string[]
): PlannedDispatchOrder[] {
  return orders.map((order) => {
    const extras = dispatchPackagingRuleExtras(order, rules)
      .flatMap((extra): DispatchPackageAllocation[] => {
        const packaging = packages.find(
          (candidate) => candidate.id === extra.packagingTypeId
        );
        if (!packaging || !packaging.active) {
          const message = `An automatic packaging rule uses ${
            packaging?.name ?? "a packaging format"
          } that is inactive or missing.`;
          if (!blockers.includes(message)) blockers.push(message);
          return [];
        }
        return [
          {
            packagingTypeId: packaging.id,
            code: packaging.code,
            name: packaging.name,
            quantity: extra.quantity,
            unitVolumeCm3: 0,
            source: "rule",
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...order, extras: extras.length > 0 ? extras : undefined };
  });
}

function summarizeDispatchPackaging(
  plannedOrders: PlannedDispatchOrder[],
  packages: PackagingOption[],
  initialBlockers: string[] = []
): DispatchPlan {
  const blockers = [...initialBlockers];

  const usageById = new Map<string, DispatchPackageUsage>();
  for (const order of plannedOrders) {
    for (const allocation of [...order.packages, ...(order.extras ?? [])]) {
      const packaging = packages.find(
        (candidate) => candidate.id === allocation.packagingTypeId
      );
      if (!packaging) {
        blockers.push(
          `Order ${order.orderId}: the selected packaging format is unavailable.`
        );
        continue;
      }
      const current = usageById.get(allocation.packagingTypeId);
      const quantity = (current?.quantity ?? 0) + allocation.quantity;
      usageById.set(allocation.packagingTypeId, {
        ...allocation,
        quantity,
        onHandStock: packaging.onHandStock,
        reservedStock: packaging.reservedStock,
        availableStock: packaging.onHandStock - packaging.reservedStock,
        stockAfter: packaging.onHandStock - quantity,
      });
    }
  }

  const packageUsage = Array.from(usageById.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const usage of packageUsage) {
    if (usage.quantity > usage.availableStock) {
      blockers.push(
        `${usage.name}: ${usage.quantity} required, but only ${usage.availableStock} available.`
      );
    }
  }

  return {
    orders: plannedOrders,
    packageUsage,
    blockers,
    totalPackages: packageUsage.reduce((total, usage) => total + usage.quantity, 0),
  };
}

export type ManualPackagingLine = {
  packagingTypeId: string;
  quantity: number;
};

// Name shown in Dispatch History for a manual packaging outbound.
export function manualOutboundName(reference: string, comment: string) {
  return ["Manual outbound", reference, comment]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ")
    .slice(0, 255);
}

// A manual packaging outbound is planned as one pseudo-order, so it is
// deducted, listed and undone like a daily dispatch. Packaging rules apply to
// the chosen boxes (a Radius Box brings its sleeve and plastic envelope).
export function planManualPackagingOutbound(
  orderId: string,
  lines: ManualPackagingLine[],
  packages: PackagingOption[],
  rules: DispatchPackagingRule[] = []
): DispatchPlan {
  const blockers: string[] = [];
  const block = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };

  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1_000_000
    ) {
      block("Every line needs a quantity between 1 and 1,000,000.");
      continue;
    }
    quantities.set(
      line.packagingTypeId,
      (quantities.get(line.packagingTypeId) || 0) + line.quantity
    );
  }

  const allocations: DispatchPackageAllocation[] = [];
  for (const [packagingTypeId, quantity] of quantities) {
    const packaging = packages.find((candidate) => candidate.id === packagingTypeId);
    if (!packaging || !packaging.active) {
      block("A selected packaging format is inactive or missing.");
      continue;
    }
    allocations.push({
      packagingTypeId,
      code: packaging.code,
      name: packaging.name,
      quantity,
      unitVolumeCm3: 0,
      source: "manual",
    });
  }
  if (allocations.length === 0 && blockers.length === 0) {
    block("Add at least one packaging line.");
  }

  const order: PlannedDispatchOrder = {
    orderId,
    destinationCountry: "",
    companyName: "",
    lineCount: Math.max(1, quantities.size),
    totalVolumeCm3: 0,
    adjustedVolumeCm3: 0,
    deviceCounts: {},
    items: [],
    packages: allocations.sort((a, b) => a.name.localeCompare(b.name)),
  };
  return summarizeDispatchPackaging(
    withPackagingRuleExtras([order], packages, rules, blockers),
    packages,
    blockers
  );
}

export function eligibleDispatchPackagingIds(
  order: DispatchOrder,
  packages: PackagingOption[]
) {
  return packages
    .filter(
      (packaging) =>
        packaging.active &&
        isPackagingContainer(packaging.category) &&
        order.items.every((item) => itemFitsPackage(item, packaging))
    )
    .map((packaging) => packaging.id);
}

export function applyDispatchPackagingSelections(
  orders: DispatchOrder[],
  packages: PackagingOption[],
  selections: DispatchPackagingSelection[],
  rules: DispatchPackagingRule[] = []
): DispatchPlan {
  const automatic = planDispatchPackaging(orders, packages);
  const automaticByOrder = new Map(
    automatic.orders.map((order) => [order.orderId, order])
  );
  const orderIds = new Set(orders.map((order) => order.orderId));
  const selectionByOrder = new Map<string, DispatchPackagingSelection>();
  const blockers: string[] = [];

  for (const selection of selections) {
    if (!orderIds.has(selection.orderId)) {
      blockers.push(`Unknown order ${selection.orderId} in packaging selection.`);
      continue;
    }
    if (selectionByOrder.has(selection.orderId)) {
      blockers.push(`Order ${selection.orderId} has more than one packaging selection.`);
      continue;
    }
    selectionByOrder.set(selection.orderId, selection);
  }

  const plannedOrders = orders.map((order) => {
    const selection = selectionByOrder.get(order.orderId);
    if (!selection) {
      const planned = automaticByOrder.get(order.orderId);
      if (!planned?.packages.length) {
        blockers.push(
          `Order ${order.orderId}: no active packaging format can fit every item.`
        );
      }
      return planned ?? { ...order, packages: [] };
    }

    const packaging = packages.find(
      (candidate) => candidate.id === selection.packagingTypeId
    );
    if (!packaging || !packaging.active) {
      blockers.push(
        `Order ${order.orderId}: the selected packaging format is unavailable.`
      );
      return { ...order, packages: [] };
    }
    if (!isPackagingContainer(packaging.category)) {
      blockers.push(
        `Order ${order.orderId}: ${packaging.name} is a sleeve and cannot hold an order.`
      );
      return { ...order, packages: [] };
    }
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > 1_000_000
    ) {
      blockers.push(`Order ${order.orderId}: the package quantity is invalid.`);
      return { ...order, packages: [] };
    }
    const selectionSource = selection.source ?? "manual";
    if (
      selectionSource === "calculated" &&
      !order.items.every((item) => itemFitsPackage(item, packaging))
    ) {
      blockers.push(
        `Order ${order.orderId}: ${packaging.name} cannot fit at least one item dimension.`
      );
      return { ...order, packages: [] };
    }

    return {
      ...order,
      packages: [
        {
          packagingTypeId: packaging.id,
          code: packaging.code,
          name: packaging.name,
          quantity: selection.quantity,
          unitVolumeCm3:
            packaging.lengthCm * packaging.widthCm * packaging.heightCm,
          source: selectionSource,
          learningCount: selection.learningCount,
        },
      ],
    };
  });

  return summarizeDispatchPackaging(
    withPackagingRuleExtras(plannedOrders, packages, rules, blockers),
    packages,
    blockers
  );
}
