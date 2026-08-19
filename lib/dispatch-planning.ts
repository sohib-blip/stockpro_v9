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
  hardwareType: string;
  deviceType: string;
  mappedItem: string;
  destinationCountry: string;
  companyName: string;
};

export type DispatchOrderItem = DispatchCatalogItem & {
  sourceItem: string;
  quantity: number;
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
  items: DispatchOrderItem[];
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
  { name: "FOB", lengthCm: 5, widthCm: 2, heightCm: 2 },
  { name: "HARDWIRED Cable for", lengthCm: 14, widthCm: 5, heightCm: 5 },
  { name: "READER", lengthCm: 11, widthCm: 7, heightCm: 0.5 },
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

function normalized(value: unknown) {
  return String(value ?? "")
    .replace(/^\s*\*+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function key(value: unknown) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const CATALOG_BY_KEY = new Map(
  ITEM_CATALOG.flatMap((item) => {
    const aliases = [item.name];
    if (item.name === "HARDWIRED Cable for") aliases.push("HARDWIRED Cable for CV200");
    if (item.name === "CNHYCV200XEU") aliases.push("AIO Camera", "CV200XEU", "CV200XEU-256");
    if (item.name === "BarraGps") aliases.push("Barra-GPS", "Neon");
    return aliases.map((alias) => [key(alias), item] as const);
  })
);

function modelFromDeviceType(value: string) {
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
  const hardwareKey = key(cleanHardware);

  if (hardwareKey === "aiocamera") {
    return CATALOG_BY_KEY.get(key("CNHYCV200XEU")) ?? null;
  }

  if (["atom", "hardwired", "neon"].includes(hardwareKey)) {
    const model = modelFromDeviceType(deviceType);
    return model ? CATALOG_BY_KEY.get(key(model)) ?? null : null;
  }

  return CATALOG_BY_KEY.get(hardwareKey) ?? null;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return normalized(value);
}

function headerIndex(row: unknown[]) {
  const map = new Map(row.map((value, index) => [key(value), index]));
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
    const indexOf = (name: string) => indexes.get(key(name));
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

      lines.push({
        sheet: sheetName,
        row: index + 1,
        orderId,
        orderLineId: value("Order Line ID"),
        hardwareType: normalized(hardwareType),
        deviceType: normalized(deviceType),
        mappedItem: catalogItem.name,
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
        groupedItems.set(line.mappedItem, [
          ...(groupedItems.get(line.mappedItem) ?? []),
          line,
        ]);
      }

      const items = Array.from(groupedItems.entries()).map(
        ([mappedItem, itemLines]) => {
          const catalogItem = CATALOG_BY_KEY.get(key(mappedItem))!;
          const unitVolumeCm3 =
            catalogItem.lengthCm * catalogItem.widthCm * catalogItem.heightCm;
          return {
            ...catalogItem,
            sourceItem: itemLines[0].hardwareType,
            quantity: itemLines.length,
            unitVolumeCm3,
            totalVolumeCm3: unitVolumeCm3 * itemLines.length,
          };
        }
      );
      const totalVolumeCm3 = items.reduce(
        (total, item) => total + item.totalVolumeCm3,
        0
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
        },
      ],
    });
  }

  const usageById = new Map<string, DispatchPackageUsage>();
  for (const order of plannedOrders) {
    for (const allocation of order.packages) {
      const packaging = packages.find(
        (candidate) => candidate.id === allocation.packagingTypeId
      )!;
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
