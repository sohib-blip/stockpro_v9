import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath = join(
  root,
  "supabase/migrations/20260723190000_enforce_workload_budgets.sql"
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("workload protection boundaries", () => {
  it("uses private atomic shared budget state with expiring leases", () => {
    expect(migration).toContain("create table public.workload_budget_buckets");
    expect(migration).toContain("create table public.workload_leases");
    expect(migration).toContain(
      "function public.acquire_workload_lease("
    );
    expect(migration).toContain(
      "function public.release_workload_lease("
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  it.each([
    ["app/api/auth/login/route.ts", "supabase.auth.signInWithPassword"],
    ["app/api/dashboard/export/route.ts", 'from("stock_export_view")'],
    [
      "app/api/dashboard/export-count-sheet/route.ts",
      'from("stock_export_view")',
    ],
    ["app/api/outbound/eod-preview/route.ts", "await extractWorkbookValues(req)"],
    ["app/api/outbound/shipment-pdf/route.ts", "new PDFDocument"],
    ["app/api/returns/history/route.ts", ".rpc("],
    ["app/api/transfer/preview/route.ts", ".rpc("],
  ])(
    "admits %s before its expensive transition",
    (routePath, expensiveTransition) => {
      const source = read(routePath);
      const admission = source.indexOf(
        "const admission = await acquireWorkloadLease"
      );
      const expensive = source.indexOf(expensiveTransition);

      expect(admission).toBeGreaterThanOrEqual(0);
      expect(expensive).toBeGreaterThan(admission);
      expect(source).toContain("releaseWorkloadLease");
    }
  );

  it("bounds outbound parsing, semantic IMEIs, PDF generation and exports", () => {
    const outbound = read("app/api/outbound/eod-preview/route.ts");
    const shipment = read("app/api/outbound/shipment-pdf/route.ts");
    const stockExport = read("app/api/dashboard/export/route.ts");
    const countSheet = read(
      "app/api/dashboard/export-count-sheet/route.ts"
    );

    expect(outbound).toContain("inspectXlsxZipEnvelope");
    expect(outbound).toContain("measureWorkbookShape");
    expect(outbound).toContain("MAX_PREVIEW_IMEIS");
    expect(outbound).toContain('"get_outbound_box_stock_counts"');
    expect(outbound).not.toMatch(
      /for \(const row of Object\.values\(summaryMap\)[\s\S]*?\.from\("stock_export_view"\)/
    );

    expect(shipment).toContain("MAX_SHIPMENT_IMEIS");
    expect(shipment).toContain("readJsonBodyWithinLimit");
    expect(stockExport).toContain("MAX_EXPORT_ROWS");
    expect(stockExport).toContain("MAX_EXPORT_ROWS + 1");
    expect(countSheet).toContain("MAX_COUNT_SHEET_ROWS");
    expect(countSheet).toContain("MAX_FORMULA_CELLS");
  });

  it("moves grouped returns and transfer counts into bounded database queries", () => {
    const history = read("app/api/returns/history/route.ts");
    const transfer = read("app/api/transfer/preview/route.ts");

    expect(migration).toContain("create table public.return_history_entries");
    expect(migration).toContain(
      "function public.get_return_history_page("
    );
    expect(migration).toContain(
      "function public.preview_box_transfer("
    );
    expect(history).toContain('"get_return_history_page"');
    expect(history).not.toContain("while (true)");
    expect(history).not.toContain('.from("movements")');
    expect(transfer).toContain('"preview_box_transfer"');
    expect(transfer).not.toContain('.from("items")');
  });

  it("moves retention out of each login event and into scheduled maintenance", () => {
    const recorder = read("lib/security/connection-events.ts");
    const cron = read("app/api/cron/low-stock/route.ts");

    expect(recorder).not.toContain('.from("connection_events")\n    .delete()');
    expect(migration).toContain(
      "function public.run_workload_maintenance("
    );
    expect(cron).toContain('"run_workload_maintenance"');
  });
});
