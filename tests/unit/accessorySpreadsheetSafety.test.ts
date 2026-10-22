import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const route = readFileSync(
  join(root, "app/api/accessories/outbound/excel/route.ts"),
  "utf8"
);
const page = readFileSync(
  join(root, "app/(app)/accessories/page.tsx"),
  "utf8"
);
const previewHelpers = readFileSync(
  join(root, "lib/accessory-outbound-preview.ts"),
  "utf8"
);

describe("accessory End-of-Day spreadsheet safety", () => {
  it("uses the structured report parser and report-first calculation", () => {
    expect(route).toContain("parseEndOfDayWorkbook");
    expect(route).toContain("buildAccessoryEndOfDayPreview");
    // The preview tells which quantities come from the report and which from rules.
    expect(page).toContain("spreadsheetSource(row)");
    expect(previewHelpers).toContain("From report");
    expect(previewHelpers).toContain("automatic rule");
  });

  it("derives an idempotency key from the file and blocks confirmed reports", () => {
    expect(route).toContain("accessoryReportOperationId(buffer)");
    expect(route).toContain('.from("inventory_command_receipts")');
    expect(route).toContain("duplicate_report: true");
    expect(route).toContain("No stock was removed again");
  });

  it("bounds uploaded workbook size and shape before parsing", () => {
    expect(route).toContain("readBodyWithinLimit");
    expect(route).toContain("inspectXlsxZipEnvelope");
    expect(route).toContain("measureWorkbookShape");
    expect(route).toContain("releaseWorkloadLease");
  });
});
