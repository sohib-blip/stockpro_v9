import {
  EndOfDayParseResult,
  normalizeEndOfDayLabel,
} from "./endOfDayParser";

export type AccessoryStockBin = {
  id: string;
  name: string;
  current_stock: number | null;
};

export type EndOfDayStockItem = {
  imei: string;
  device_id: string | null;
};

export type DeviceAccessoryTemplate = {
  device_id: string;
  accessory_bin_id: string;
  quantity: number | null;
  per_devices: number | null;
};

export type AccessoryEndOfDayIssue = {
  message: string;
  sheet?: string;
  row?: number;
};

export type AccessoryEndOfDayPreviewRow = {
  accessory_bin_id: string;
  accessory: string;
  report_qty: number;
  template_expected_qty: number;
  template_qty: number;
  qty: number;
  current_stock: number;
  after_stock: number;
};

export function buildAccessoryEndOfDayPreview(input: {
  report: EndOfDayParseResult;
  accessoryBins: AccessoryStockBin[];
  stockItems: EndOfDayStockItem[];
  templates: DeviceAccessoryTemplate[];
}) {
  const { report, accessoryBins, stockItems, templates } = input;
  const issues: AccessoryEndOfDayIssue[] = report.errors.map((issue) => ({
    message: issue.message,
    sheet: issue.sheet,
    row: issue.row,
  }));

  for (const duplicate of report.duplicates) {
    const first = duplicate.locations[0];
    issues.push({
      message: `Device IMEI ${duplicate.imei} is selected ${duplicate.count} times.`,
      sheet: first?.sheet,
      row: first?.row,
    });
  }

  const binsById = new Map(accessoryBins.map((bin) => [bin.id, bin]));
  const binsByLabel = new Map<string, AccessoryStockBin>();
  const normalizedBins: Array<{ key: string; bin: AccessoryStockBin }> = [];
  for (const bin of accessoryBins) {
    const key = normalizeEndOfDayLabel(bin.name);
    const existing = binsByLabel.get(key);
    if (existing && existing.id !== bin.id) {
      issues.push({
        message: `Accessory bins ${existing.name} and ${bin.name} normalize to the same report name.`,
      });
      continue;
    }
    binsByLabel.set(key, bin);
    normalizedBins.push({ key, bin });
  }

  const reportQuantities = new Map<string, number>();
  const unmappedLabels = new Set<string>();
  for (const row of report.accessories) {
    const normalized = normalizeEndOfDayLabel(row.itemType);
    let bin = binsByLabel.get(normalized);

    if (!bin) {
      const prefixMatches = normalizedBins.filter(({ key }) =>
        key.startsWith(`${normalized} `)
      );
      if (prefixMatches.length === 1) {
        bin = prefixMatches[0].bin;
      } else if (prefixMatches.length > 1 && !unmappedLabels.has(normalized)) {
        issues.push({
          message: `Accessory Item Type \"${row.itemType}\" matches multiple active bins: ${prefixMatches.map(({ bin: candidate }) => candidate.name).join(", ")}.`,
          sheet: row.sheet,
          row: row.row,
        });
        unmappedLabels.add(normalized);
        continue;
      }
    }

    if (!bin) {
      if (!unmappedLabels.has(normalized)) {
        issues.push({
          message: `Accessory Item Type \"${row.itemType}\" does not match an active accessory bin.`,
          sheet: row.sheet,
          row: row.row,
        });
        unmappedLabels.add(normalized);
      }
      continue;
    }

    reportQuantities.set(bin.id, (reportQuantities.get(bin.id) || 0) + 1);
  }

  const stockByImei = new Map(
    stockItems.map((item) => [String(item.imei), item])
  );
  const deviceCounts = new Map<string, number>();
  const missingImeis = new Set<string>();

  for (const device of report.devices) {
    const item = stockByImei.get(device.imei);
    if (!item?.device_id) {
      if (!missingImeis.has(device.imei)) {
        issues.push({
          message: `Device IMEI ${device.imei} is not linked to a StockPro device template.`,
          sheet: device.sheet,
          row: device.row,
        });
        missingImeis.add(device.imei);
      }
      continue;
    }

    deviceCounts.set(
      item.device_id,
      (deviceCounts.get(item.device_id) || 0) + 1
    );
  }

  const templateExpected = new Map<string, number>();
  for (const template of templates) {
    const deviceCount = deviceCounts.get(template.device_id) || 0;
    if (deviceCount === 0) continue;

    const quantity = Number(template.quantity);
    const perDevices = Number(template.per_devices);
    if (
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !Number.isSafeInteger(perDevices) ||
      perDevices <= 0
    ) {
      issues.push({
        message: `An automatic accessory template for device ${template.device_id} has an invalid quantity.`,
      });
      continue;
    }

    if (!binsById.has(template.accessory_bin_id)) {
      issues.push({
        message: `An automatic template points to an inactive or missing accessory bin (${template.accessory_bin_id}).`,
      });
      continue;
    }

    const expected = Math.ceil(deviceCount / perDevices) * quantity;
    templateExpected.set(
      template.accessory_bin_id,
      (templateExpected.get(template.accessory_bin_id) || 0) + expected
    );
  }

  const affectedBinIds = new Set([
    ...reportQuantities.keys(),
    ...templateExpected.keys(),
  ]);
  const rows: AccessoryEndOfDayPreviewRow[] = [];

  for (const accessoryBinId of affectedBinIds) {
    const bin = binsById.get(accessoryBinId);
    if (!bin) continue;

    const reportQty = reportQuantities.get(accessoryBinId) || 0;
    const templateExpectedQty = templateExpected.get(accessoryBinId) || 0;
    const templateQty = Math.max(0, templateExpectedQty - reportQty);
    const qty = reportQty + templateQty;
    const currentStock = Number(bin.current_stock || 0);

    if (currentStock < qty) {
      issues.push({
        message: `Not enough stock for ${bin.name}. Stock: ${currentStock}, needed: ${qty}.`,
      });
    }

    rows.push({
      accessory_bin_id: accessoryBinId,
      accessory: bin.name,
      report_qty: reportQty,
      template_expected_qty: templateExpectedQty,
      template_qty: templateQty,
      qty,
      current_stock: currentStock,
      after_stock: currentStock - qty,
    });
  }

  rows.sort((left, right) => left.accessory.localeCompare(right.accessory));

  if (rows.length === 0 && issues.length === 0) {
    issues.push({
      message:
        "No accessories to remove. The report contains no mapped accessory rows or automatic templates.",
    });
  }

  return { rows, issues };
}
