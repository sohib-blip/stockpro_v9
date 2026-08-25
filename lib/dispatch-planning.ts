import * as XLSX from "xlsx";

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
  source?: "calculated" | "learned" | "manual";
  learningCount?: number;
};

export type PlannedDispatchOrder = DispatchOrder & {
  packages: DispatchPackageAllocation[];
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

export type DispatchPackagingSelection = {
  orderId: string;
  packagingTypeId: string;
  quantity: number;
  source?: "calculated" | "learned" | "manual";
  learningCount?: number;
};

const ITEM_CATALOG: DispatchCatalogItem[] = [
  { name: "10M AV Extension Cable", lengthCm: 13, widthCm: 13, heightCm: 3 },
  { name: "3M AV Extension Cable", lengthCm: 13, widthCm: 4, heightCm: 4 },
  { name: "Camera - Front Facing", lengthCm: 9.5, widthCm: 9.5, heightCm: 12 },
  { name: "Camera - Rear/Bracket Mounted", lengthCm: 10, widthCm: 9, heightCm: 9 },
  { name: "DVR - 2 Channel -  (N+)", lengthCm: 20, widthCm: 18, heightCm: 7 },
  { name: "Storage - 256GB SD Card", lengthCm: 2.2, widthCm: 3, heightCm: 0.2 },
  { name: "BUZZER", lengthCm: 2, widthCm: 4, heightCm: 4 },
  { name: "CV200 Bullet Camera", lengthCm: 5, widthCm: 3, heightCm: 6 },
  { name: "FMB130 connectorized harness", lengthCm: 1.5, widthCm: 7, heightCm: 7 },
  { name: "FMB140 connectorized harness", lengthCm: 1.5, widthCm: 7, heightCm: 7 },
  { name: "3 amp Fuse mini blade", lengthCm: 1.5, widthCm: 1.5, heightCm: 0.3 },
  { name: "Fuse Holder - mini blade in-line", lengthCm: 10.5, widthCm: 2, heightCm: 0.3 },
  { name: "Teltonika Contactless CAN - ECAN02", lengthCm: 2, widthCm: 9, heightCm: 2 },
  { name: "FOB", lengthCm: 5, widthCm: 2, heightCm: 2 },
  { name: "OBD Cable", lengthCm: 1.5, widthCm: 13, heightCm: 11 },
  { name: "HARDWIRED Cable for", lengthCm: 14, widthCm: 5, heightCm: 5 },
  { name: "READER", lengthCm: 11, widthCm: 7, heightCm: 0.5 },
  { name: "Atom Install Guide", lengthCm: 5.5, widthCm: 8.3, heightCm: 0.1 },
  { name: "Barra Adhesive Pad", lengthCm: 14.5, widthCm: 4.5, heightCm: 0.2 },
  { name: "CV200 Adhesive Pad", lengthCm: 7, widthCm: 5, heightCm: 0.2 },
  { name: "Tachograph T-Harness", lengthCm: 16, widthCm: 12, heightCm: 2 },
  { name: "WIPE", lengthCm: 6.5, widthCm: 7.5, heightCm: 0.3 },
  // The official volume workbook intentionally has no dimensions for these
  // flexible consumables. They remain visible in the packing list but add no
  // incremental box volume because they fit around the device contents.
  { name: "Large Cable Ties", lengthCm: 0, widthCm: 0, heightCm: 0 },
  { name: "NEON-T Adhesive Pads", lengthCm: 0, widthCm: 0, heightCm: 0 },
  { name: "T7 Adhesive pad", lengthCm: 0, widthCm: 0, heightCm: 0 },
  { name: "CNHYCV200XEU", lengthCm: 9, widthCm: 20, heightCm: 23.5 },
  { name: "BarraGps", lengthCm: 2.5, widthCm: 5.5, heightCm: 16 },
  { name: "FMC003", lengthCm: 2.5, widthCm: 5, heightCm: 7 },
  { name: "FMC130", lengthCm: 6.4, widthCm: 5.5, heightCm: 2 },
  { name: "FMC234", lengthCm: 15, widthCm: 11, heightCm: 3 },
  { name: "FMC650", lengthCm: 10, widthCm: 7, heightCm: 3 },
  { name: "FMC920", lengthCm: 4, widthCm: 8, heightCm: 2 },
  { name: "FMB140", lengthCm: 6.4, widthCm: 5.5, heightCm: 2 },
  { name: "FMC880", lengthCm: 6, widthCm: 9, heightCm: 1.5 },
  { name: "Howen2CH", lengthCm: 20, widthCm: 18, heightCm: 7 },
  { name: "Neon-P", lengthCm: 8, widthCm: 7, heightCm: 3.5 },
  { name: "Neon-R", lengthCm: 8, widthCm: 7, heightCm: 3 },
  { name: "Howen8CH", lengthCm: 25, widthCm: 24, heightCm: 15 },
  { name: "Howen4CH", lengthCm: 25, widthCm: 24, heightCm: 15 },
];

const DISPATCH_CATALOG_ALIASES: Record<string, string[]> = {
  "Atom Install Guide": ["Atom Install Guide TBD001"],
  "Barra Adhesive Pad": ["Barra Adhesive Pad BAP01"],
  "CV200 Adhesive Pad": [
    "CV200 adhesive pad CVAP",
    "CV200 Adhesive Pad CVAP01",
  ],
  "FMB130 connectorized harness": ["FMB130 connectorized harness 22"],
  "FMB140 connectorized harness": ["FMB140 connectorized harness 23"],
  "3 amp Fuse mini blade": ["3 amp Fuse mini blade 11"],
  "Fuse Holder - mini blade in-line": ["Fuse Holder - mini blade in-line 10"],
  "Teltonika Contactless CAN - ECAN02": ["ECAN02"],
  "OBD Cable": ["OBD Cable FMC003"],
  "Large Cable Ties": ["Large Cable Ties 25"],
  "NEON-T Adhesive Pads": ["NEON-T Adhesive Pads 24"],
  "T7 Adhesive pad": ["T7 Adhesive pad T7Pad"],
  "Tachograph T-Harness": ["Tachograph T-Harness Tacho-T-harness"],
  WIPE: ["WIPE TBD011"],
};

function normalized(value: unknown) {
  return String(value ?? "")
    .replace(/^\s*\*+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dispatchItemKey(value: unknown) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isEcan02DeviceBundle(value: unknown) {
  const key = dispatchItemKey(value);
  return key.includes("contactlesscan") && key.includes("ecan02");
}

export function isDispatchVolumeAccessoryCategory(category: unknown) {
  return dispatchItemKey(category) !== "packages";
}

const CATALOG_BY_KEY = new Map(
  ITEM_CATALOG.flatMap((item) => {
    const aliases = [
      item.name,
      ...(DISPATCH_CATALOG_ALIASES[item.name] ?? []),
    ];
    if (item.name === "HARDWIRED Cable for") aliases.push("HARDWIRED Cable for CV200");
    if (item.name === "CNHYCV200XEU") aliases.push("AIO Camera", "CV200XEU", "CV200XEU-256");
    if (item.name === "BarraGps") aliases.push("Barra-GPS", "Neon");
    return aliases.map((alias) => [dispatchItemKey(alias), item] as const);
  })
);

export function resolveDispatchDeviceModel(value: string) {
  const normalizedValue = value.toUpperCase();
  const patterns: Array<[RegExp, string]> = [
    [/CV200XEU|CNHYCV200/, "CNHYCV200XEU"],
    [/BARRA[\s-]?GPS/, "BarraGps"],
    [/FMC003/, "FMC003"],
    [/FMC130/, "FMC130"],
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

export function resolveDispatchCatalogItem(
  hardwareType: string,
  deviceType: string
) {
  const cleanHardware = normalized(hardwareType);
  const hardwareKey = dispatchItemKey(cleanHardware);

  if (hardwareKey === "aiocamera") {
    return CATALOG_BY_KEY.get(dispatchItemKey("CNHYCV200XEU")) ?? null;
  }

  if (isEcan02DeviceBundle(cleanHardware)) {
    const model = resolveDispatchDeviceModel(deviceType);
    return model === "FMB140"
      ? CATALOG_BY_KEY.get(dispatchItemKey(model)) ?? null
      : null;
  }

  // Kinesis exports the FMC650 tachograph harness under the generic label
  // "HARNESS". Keep this contextual so unrelated generic harness rows do not
  // inherit dimensions that may not match their physical item.
  if (
    hardwareKey === "harness" &&
    resolveDispatchDeviceModel(deviceType) === "FMC650"
  ) {
    return CATALOG_BY_KEY.get(dispatchItemKey("Tachograph T-Harness")) ?? null;
  }

  if (["atom", "hardwired", "neon", "obd", "trailer"].includes(hardwareKey)) {
    const model = resolveDispatchDeviceModel(deviceType);
    return model ? CATALOG_BY_KEY.get(dispatchItemKey(model)) ?? null : null;
  }

  return CATALOG_BY_KEY.get(hardwareKey) ?? null;
}

export function resolveDispatchLineDeviceModel(
  hardwareType: string,
  deviceType: string,
  mappedItem?: string
) {
  const hardwareKey = dispatchItemKey(hardwareType);
  if (hardwareKey === "aiocamera") return "CNHYCV200XEU";
  if (isEcan02DeviceBundle(hardwareType)) {
    return resolveDispatchDeviceModel(deviceType) === "FMB140"
      ? "FMB140"
      : null;
  }
  if (["atom", "hardwired", "neon", "obd", "trailer"].includes(hardwareKey)) {
    return resolveDispatchDeviceModel(deviceType);
  }
  if (hardwareKey.startsWith("dvr")) {
    if (/dvr.*2channel/.test(hardwareKey)) return "Howen2CH";
    if (/dvr.*4channel/.test(hardwareKey)) return "Howen4CH";
    if (/dvr.*8channel/.test(hardwareKey)) return "Howen8CH";
    const item = mappedItem || resolveDispatchCatalogItem(hardwareType, deviceType)?.name;
    return item && /^Howen(?:2|4|8)CH$/i.test(item) ? item : null;
  }
  return null;
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
    const match = joined.match(/Generated Date:\s*(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function parseDispatchWorkbook(workbook: XLSX.WorkBook): DispatchParseResult {
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

      const catalogItem = resolveDispatchCatalogItem(hardwareType, deviceType);
      if (!catalogItem) {
        issues.push({
          sheet: sheetName,
          row: index + 1,
          message: "No trusted dimensions match this hardware/device combination.",
          hardwareType,
          deviceType,
        });
        continue;
      }

      const deviceModel = resolveDispatchLineDeviceModel(
        hardwareType,
        deviceType,
        catalogItem.name
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
          const catalogItem = CATALOG_BY_KEY.get(dispatchItemKey(mappedItem))!;
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
  rules: DispatchAutomaticAccessoryRule[]
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

      const catalogItem = resolveDispatchCatalogItem(rule.accessoryName, "");
      if (!catalogItem) {
        issues.push({
          sheet: "Automatic accessory rules",
          row: 1,
          message: `Automatic accessory ${rule.accessoryName} for ${rule.deviceModel} has no trusted dimensions.`,
          hardwareType: rule.accessoryName,
          deviceType: rule.deviceModel,
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
  packages: PackagingOption[]
): DispatchPlan {
  const activePackages = packages.filter((packaging) => packaging.active);
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

  return summarizeDispatchPackaging(plannedOrders, packages, blockers);
}

function summarizeDispatchPackaging(
  plannedOrders: PlannedDispatchOrder[],
  packages: PackagingOption[],
  initialBlockers: string[] = []
): DispatchPlan {
  const blockers = [...initialBlockers];

  const usageById = new Map<string, DispatchPackageUsage>();
  for (const order of plannedOrders) {
    for (const allocation of order.packages) {
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

export function eligibleDispatchPackagingIds(
  order: DispatchOrder,
  packages: PackagingOption[]
) {
  return packages
    .filter(
      (packaging) =>
        packaging.active &&
        order.items.every((item) => itemFitsPackage(item, packaging))
    )
    .map((packaging) => packaging.id);
}

export function applyDispatchPackagingSelections(
  orders: DispatchOrder[],
  packages: PackagingOption[],
  selections: DispatchPackagingSelection[]
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
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > 1_000_000
    ) {
      blockers.push(`Order ${order.orderId}: the package quantity is invalid.`);
      return { ...order, packages: [] };
    }
    if (!order.items.every((item) => itemFitsPackage(item, packaging))) {
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
          source: selection.source ?? "manual",
          learningCount: selection.learningCount,
        },
      ],
    };
  });

  return summarizeDispatchPackaging(plannedOrders, packages, blockers);
}
