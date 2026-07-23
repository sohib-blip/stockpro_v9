import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  WORKLOAD_POLICIES,
  type WorkloadName,
} from "../../lib/security/workload-budget";
import {
  PayloadTooLargeError,
  readJsonBodyWithinLimit,
} from "../../lib/security/request-budget";
import {
  inspectXlsxZipEnvelope,
  measureWorkbookShape,
} from "../../lib/security/xlsx-budget";

describe("shared workload budgets", () => {
  it("registers every expensive route with bounded rate and concurrency", () => {
    const expected: WorkloadName[] = [
      "login",
      "dashboardExport",
      "countSheetExport",
      "outboundPreview",
      "shipmentPdf",
      "returnsHistory",
      "transferPreview",
    ];

    expect(Object.keys(WORKLOAD_POLICIES).sort()).toEqual(expected.sort());
    expect(
      new Set(Object.values(WORKLOAD_POLICIES).map((policy) => policy.routeClass))
        .size
    ).toBe(expected.length);

    for (const policy of Object.values(WORKLOAD_POLICIES)) {
      expect(policy.windowSeconds).toBeGreaterThan(0);
      expect(policy.principalLimit).toBeGreaterThan(0);
      expect(policy.sourceLimit).toBeGreaterThan(0);
      expect(policy.globalLimit).toBeGreaterThan(0);
      expect(policy.principalConcurrency).toBeGreaterThan(0);
      expect(policy.routeConcurrency).toBeGreaterThan(0);
      expect(policy.routeConcurrency).toBeGreaterThanOrEqual(
        policy.principalConcurrency
      );
      expect(policy.globalConcurrency).toBeGreaterThanOrEqual(
        policy.routeConcurrency
      );
      expect(policy.leaseSeconds).toBeGreaterThan(0);
    }
  });

  it("rejects an oversized JSON body before parsing it", async () => {
    const accepted = new Request("https://stockpro.test/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "1234" }),
    });
    await expect(readJsonBodyWithinLimit(accepted, 64)).resolves.toEqual({
      value: "1234",
    });

    const rejected = new Request("https://stockpro.test/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(128) }),
    });
    await expect(readJsonBodyWithinLimit(rejected, 64)).rejects.toBeInstanceOf(
      PayloadTooLargeError
    );
  });

  it("checks the XLSX ZIP envelope and worksheet dimensions before traversal", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["IMEI"],
        ["123456789012345"],
      ]),
      "Devices"
    );
    const buffer = Buffer.from(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
    );

    expect(
      inspectXlsxZipEnvelope(buffer, {
        maxCompressedBytes: buffer.length,
        maxExpandedBytes: 2_000_000,
        maxEntries: 128,
        maxEntryBytes: 1_000_000,
        maxCompressionRatio: 100,
      }).entries
    ).toBeGreaterThan(0);

    expect(() =>
      inspectXlsxZipEnvelope(buffer, {
        maxCompressedBytes: buffer.length - 1,
        maxExpandedBytes: 2_000_000,
        maxEntries: 128,
        maxEntryBytes: 1_000_000,
        maxCompressionRatio: 100,
      })
    ).toThrow(PayloadTooLargeError);

    const parsed = XLSX.read(buffer, { type: "buffer", raw: false });
    expect(
      measureWorkbookShape(parsed, {
        maxSheets: 2,
        maxRowsPerSheet: 10,
        maxCells: 20,
      })
    ).toEqual({ sheets: 1, rows: 2, cells: 2 });
  });
});
