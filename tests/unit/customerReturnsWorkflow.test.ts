import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createReturnTemplateWorkbook,
  RETURN_TEMPLATE_HEADERS,
} from "../../lib/return-template-export";
import {
  RETURN_REASONS,
  RETURN_STATUS_VALUES,
  normalizeReturnReasonForTemplate,
  returnRequiresCanonicalItem,
} from "../../lib/returns";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read(
  "supabase/migrations/20260811143000_expand_customer_returns.sql"
).toLowerCase();
const deviceMigration = read(
  "supabase/migrations/20260811163500_add_return_reported_device.sql"
).toLowerCase();
const templateExportMigration = read(
  "supabase/migrations/20260812090000_add_return_template_exports.sql"
).toLowerCase();
const groupedHistoryMigration = read(
  "supabase/migrations/20260812103000_group_return_history_operations.sql"
).toLowerCase();
const unknownNonStockMigration = read(
  "supabase/migrations/20260817093000_allow_unknown_nonstock_returns.sql"
).toLowerCase();
const returnReasonMigration = read(
  "supabase/migrations/20260818143000_return_reason_catalog_and_lmu30g600.sql"
).toLowerCase();
const confirmRoute = read("app/api/returns/confirm/route.ts");
const previewRoute = read("app/api/returns/preview/route.ts");
const devicesRoute = read("app/api/returns/devices/route.ts");
const historyRoute = read("app/api/returns/history/route.ts");
const exportRoute = read("app/api/returns/export/route.ts");
const templateExportRoute = read(
  "app/api/returns/template-export/route.ts"
);
const templateExportStatusRoute = read(
  "app/api/returns/template-export/status/route.ts"
);
const page = read("app/(app)/returns/page.tsx");
const returnConstants = read("lib/returns.ts");

describe("complete customer return workflow", () => {
  it("keeps a service-only per-IMEI return audit ledger", () => {
    expect(migration).toContain("create table if not exists public.return_records");
    expect(migration).toContain("alter table public.return_records enable row level security");
    expect(migration).toContain(
      "revoke all on table public.return_records\n  from public, anon, authenticated"
    );
    expect(migration).toContain("to service_role");
    expect(migration).toContain("unique\n    references public.movements");
  });

  it("changes canonical inventory only for Available returns", () => {
    expect(migration).toContain("if v_status = 'available' then");
    expect(migration).toContain("set status = 'in'");
    expect(migration).toContain("v_logged_only := v_logged_only + 1");
    expect(migration).toContain(
      "case when v_status = 'available' then 'added_to_stock' else 'no_stock_change' end"
    );
    expect(migration).toContain("insert into public.return_records");
    expect(migration).toContain("return_item_state_changed");
  });

  it("accepts unknown IMEIs only for audit-only non-stock returns", () => {
    expect(returnRequiresCanonicalItem("available")).toBe(true);
    for (const status of RETURN_STATUS_VALUES.filter(
      (value) => value !== "available"
    )) {
      expect(returnRequiresCanonicalItem(status)).toBe(false);
    }
    expect(unknownNonStockMigration).toContain(
      "alter column item_id drop not null"
    );
    expect(unknownNonStockMigration).toContain(
      "alter column movement_id drop not null"
    );
    expect(unknownNonStockMigration).toContain(
      "function public.confirm_return_batch_v2("
    );
    expect(unknownNonStockMigration).toContain(
      "if v_status = 'available' and v_unknown_count > 0"
    );
    expect(unknownNonStockMigration).toContain(
      "'no_stock_change'"
    );
    expect(unknownNonStockMigration).toContain(
      "null only for audit-only non-stock returns"
    );
    expect(previewRoute).toContain("returnRequiresCanonicalItem");
    expect(previewRoute).toContain('inventory_match: "unknown"');
    expect(confirmRoute).toContain('"confirm_return_batch_v3"');
    expect(confirmRoute).toContain("p_unknown_imeis: unknownImeis");
    expect(confirmRoute).toContain(
      "Available returns must already exist in inventory"
    );
    expect(page).toContain("Not in inventory");
  });

  it("uses canonical devices for stock returns and declared devices otherwise", () => {
    expect(deviceMigration).toContain("add column if not exists reported_device");
    expect(deviceMigration).toContain(
      "when v_status = 'available' then v_item.canonical_device"
    );
    expect(deviceMigration).toContain("else v_reported_device");
    expect(deviceMigration).toContain("return_device_invalid");
    expect(confirmRoute).toContain("p_reported_device");
    expect(previewRoute).toContain("matchReturnDeviceOption");
  });

  it("requires complete business metadata and the official reason catalogue", () => {
    for (const field of [
      "return_ref",
      "return_reason",
      "return_status",
      "courier",
      "country_code",
      "customer",
      "sur_id",
      "reported_device",
    ]) {
      expect(confirmRoute).toContain(`${field}:`);
      expect(`${migration}\n${deviceMigration}`).toContain(`p_${field}`);
    }
    expect(confirmRoute).not.toContain("return_type:");
    expect(confirmRoute).toContain("RETURN_REASON_VALUES");
    expect(confirmRoute).toContain('"confirm_return_batch_v3"');
    expect(returnReasonMigration).toContain("return_reason_invalid");
    expect(returnReasonMigration).toContain("'returned device'");
    expect(page).not.toContain("Return type");
    expect(page).toContain("RETURN_REASONS.map");
    expect(RETURN_REASONS).toHaveLength(15);
    expect(RETURN_REASONS[0]).toEqual({
      value: "Returned device",
      controlCode: 10001,
    });
    expect(RETURN_REASONS.at(-1)?.controlCode).toBe(10015);
    expect(confirmRoute).toContain(
      "returnRequiresCanonicalItem(command.return_status)"
    );
    expect(confirmRoute).toContain("A target box is required for Available returns");
    expect(previewRoute).toContain("RETURN_STATUS_VALUES");
  });

  it("removes manual tracking/date fields and explains automatic timestamps", () => {
    expect(page).not.toContain("Tracking number");
    expect(page).not.toContain('aria-label="Return date"');
    expect(page).toContain(
      "Return date and time are recorded automatically on confirmation."
    );
    expect(page).toContain('useState<ReturnStatus>("available")');
    expect(returnConstants).toContain("Returned — Unprocessed");
    expect(returnConstants).toContain("Disposed");
    expect(deviceMigration).toContain(
      "'available', 'damaged', 'disposed', 'returned_unprocessed'"
    );
    expect(page).toContain("stock remains unchanged");
    expect(page).toContain('aria-label="Return device"');
    expect(page).toContain("filteredDeviceOptions");
    expect(page).toContain("RETURN_FALLBACK_DEVICE_MODELS");
    expect(page).toContain("mergeReturnDeviceOptions");
    expect(devicesRoute).toContain('.from("bins")');
    expect(devicesRoute).toContain("mergeReturnDeviceOptions");
    for (const model of [
      "LMU2640",
      "LMU30G600",
      "FMT100",
      "FMB020",
      "FMB003",
      "FMB920",
      "FMB130",
      "GL50B",
      "FMB640",
      "FMB641",
      "FMB204",
      "Badai",
    ]) {
      expect(returnConstants).toContain(model);
    }
    expect(returnReasonMigration).toContain("lmu30g600");
  });

  it("atomically claims each new template export once and can release failures", () => {
    expect(templateExportMigration).toContain(
      "create table if not exists public.return_template_export_batches"
    );
    expect(templateExportMigration).toContain("template_exported_at is null");
    expect(templateExportMigration).toContain("for update of r skip locked");
    expect(templateExportMigration).toContain(
      "claim_return_template_export_batch"
    );
    expect(templateExportMigration).toContain(
      "release_return_template_export_batch"
    );
    expect(templateExportMigration).toContain(
      "from public, anon, authenticated"
    );
    expect(templateExportRoute).toContain(
      '"claim_return_template_export_batch_v2"'
    );
    expect(templateExportRoute).toContain("operation_id");
    expect(templateExportRoute).toContain(
      '"release_return_template_export_batch"'
    );
    expect(templateExportStatusRoute).toContain(
      '.is("template_exported_at", null)'
    );
    expect(page).toContain("Download new returns");
    expect(page).toContain("Re-download");
  });

  it("fills the exact multi-device template columns and keeps IMEIs as text", async () => {
    const buffer = await createReturnTemplateWorkbook([
      {
        imei: "865031064765315",
        return_status: "available",
        return_reason: "Returned device",
      },
      {
        imei: "865031064766602",
        return_status: "damaged",
        return_reason: "Replacement (wrong device/swap out)",
      },
      {
        imei: "865031064766917",
        return_status: "disposed",
        return_reason: "Credit Stop – Fraud",
      },
      {
        imei: "865031064767634",
        return_status: "returned_unprocessed",
        return_reason: "Faulty unit",
      },
    ]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as any);
    const worksheet = workbook.getWorksheet("Sheet1");

    expect(worksheet).toBeTruthy();
    expect(
      RETURN_TEMPLATE_HEADERS.map((_, index) =>
        String(worksheet?.getCell(1, index + 1).value || "")
      )
    ).toEqual([...RETURN_TEMPLATE_HEADERS]);
    expect(worksheet?.getCell("A2").value).toBe("Returned device");
    expect(worksheet?.getCell("B2").value).toBe("865031064765315");
    expect(worksheet?.getCell("A3").value).toBe(
      "Replacement (wrong device/swap out)"
    );
    expect(worksheet?.getCell("C3").value).toBe("865031064766602");
    expect(worksheet?.getCell("A4").value).toBe("Credit Stop – Fraud");
    expect(worksheet?.getCell("D4").value).toBe("865031064766917");
    expect(worksheet?.getCell("A5").value).toBe("Other");
    expect(worksheet?.getCell("G5").value).toBe("865031064767634");
    expect(worksheet?.getCell("A2").dataValidation).toMatchObject({
      type: "list",
      formulae: ["Return_Reasons!$A$1:$A$15"],
    });
    expect(normalizeReturnReasonForTemplate("Faulty unit")).toBe("Other");
    for (const address of ["C2", "D2", "E2", "F2", "G2", "H2", "I2", "J2", "K2", "L2", "M2"]) {
      expect(worksheet?.getCell(address).value).toBeNull();
    }
  });

  it("serves bounded filterable history and a complete Brussels-time export", () => {
    expect(historyRoute).toMatch(
      /\.rpc\(\s*"get_return_operation_history_page"/
    );
    expect(groupedHistoryMigration).toContain(
      "create or replace function public.get_return_operation_history_page"
    );
    expect(groupedHistoryMigration).toContain("group by rr.operation_key");
    expect(groupedHistoryMigration).toContain("count(*)::bigint as item_count");
    expect(groupedHistoryMigration).toContain("matching.imei");
    expect(historyRoute).toContain('searchParams.get("operation_id")');
    expect(historyRoute).toContain('.eq("operation_id", operationId)');
    expect(page).toContain("One auditable row per return operation");
    expect(page).toContain('role="dialog"');
    expect(page).toContain("Device and stock location for every returned unit.");
    for (const filter of [
      "p_search",
      "p_month",
      "p_return_status",
      "p_courier",
      "p_country_code",
    ]) {
      expect(historyRoute).toContain(`${filter}:`);
    }
    expect(exportRoute).toContain('.from("return_records")');
    expect(exportRoute).toContain('timeZone: "Europe/Brussels"');
    for (const column of [
      "Return date & time",
      "Return reference",
      "SUR ID",
      "Customer",
      "Courier",
      "Country",
      "Device",
      "IMEI",
      "Status",
      "Stock action",
      "Processed by",
    ]) {
      expect(exportRoute).toContain(column);
    }
    expect(exportRoute).not.toContain("Tracking number");
    expect(exportRoute).not.toContain('"Return type"');
  });
});
