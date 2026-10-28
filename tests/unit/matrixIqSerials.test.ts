import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  deviceIdLength,
  deviceIdMismatch,
  deviceIdsInText,
  isDeviceId,
  isMatrixIqBin,
  noDeviceIdsMessage,
} from "../../lib/device-serials";
import { translateUiText } from "../../lib/i18n";
import { parseEndOfDayWorkbook } from "../../lib/outbound/endOfDayParser";

const IMEI = "865031064765315";
const SERIAL = "123456789012";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261027100000_allow_matrixiq_serial_numbers.sql"),
  "utf8"
);

function report(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Order Ref", "Item Type", "IMEI / ID", "Companion Device IMEI"], ...rows]),
    "RADIUS"
  );
  return parseEndOfDayWorkbook(workbook);
}

describe("MatrixIQ serial numbers", () => {
  it("recognises the MatrixIQ bin whatever its spelling", () => {
    for (const name of ["MatrixIQ", "MATRIXIQ", "Matrix-IQ", "Matrix iQ 2", "Matrix TagiQ", "MATRIX TAG-IQ"]) {
      expect(isMatrixIqBin(name)).toBe(true);
      expect(deviceIdLength(name)).toBe(12);
    }
    for (const name of ["FMC234", "Matrix", "Matrix Tag", "TagiQ", "CNHYCV200XEU", "", null]) {
      expect(isMatrixIqBin(name)).toBe(false);
      expect(deviceIdLength(name)).toBe(15);
    }
  });

  it("accepts 12-digit serial numbers next to 15-digit IMEIs", () => {
    expect(isDeviceId(IMEI)).toBe(true);
    expect(isDeviceId(SERIAL)).toBe(true);
    for (const value of ["12345678901", "1234567890123", "12345678901234", "1234567890123456"]) {
      expect(isDeviceId(value)).toBe(false);
    }
  });

  it("finds serial numbers in scans without changing how IMEIs are found", () => {
    expect(deviceIdsInText(`${IMEI}\n${SERIAL}\nSN:${SERIAL}\n1234567890123`)).toEqual([IMEI, SERIAL, SERIAL]);
    // Long runs of digits still give their 15-digit blocks, never a 12-digit tail.
    expect(deviceIdsInText(`${IMEI}${SERIAL}`)).toEqual([IMEI]);
    expect(deviceIdsInText(`${IMEI}${IMEI}`)).toEqual([IMEI, IMEI]);
  });

  it("blocks IMEIs in the MatrixIQ bin and serial numbers in other bins", () => {
    expect(deviceIdMismatch("MatrixIQ", [SERIAL])).toBeNull();
    expect(deviceIdMismatch("FMC234", [IMEI])).toBeNull();
    expect(deviceIdMismatch("MatrixIQ", [SERIAL, IMEI])).toBe(
      `MatrixIQ uses 12-digit serial numbers, not 15-digit IMEIs. Import blocked: ${IMEI}`
    );
    expect(deviceIdMismatch("FMC234", [IMEI, SERIAL])).toBe(
      `12-digit serial numbers are only accepted for MatrixIQ. Import blocked: ${SERIAL}`
    );
    expect(noDeviceIdsMessage("MatrixIQ")).toBe("No valid 12-digit serial numbers found.");
    expect(noDeviceIdsMessage("FMC234")).toBe("No valid 15-digit IMEIs found.");
  });

  it("reads MatrixIQ rows of the End-of-Day report with their serial number", () => {
    const result = report([
      ["A-1", "MatrixIQ", SERIAL, "N/A"],
      ["A-1", "Matrix IQ Camera", 123456789013, "N/A"],
      ["A-1", "Matrix TagiQ", "123456789014", "N/A"],
      ["A-2", "Neon", IMEI, "N/A"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.imeis).toEqual([SERIAL, "123456789013", "123456789014", IMEI]);
  });

  it("keeps the 15-digit rule for every other report device", () => {
    const result = report([
      ["A-1", "Neon", SERIAL, "N/A"],
      ["A-2", "MatrixIQ", IMEI, "N/A"],
    ]);
    expect(result.errors.map((error) => error.message)).toEqual([
      "Device Neon does not contain a valid 15-digit IMEI / ID.",
      "Device MatrixIQ does not contain a valid 12-digit serial number.",
    ]);
  });

  it("recognises Matrix TagiQ in the database too", () => {
    const tagiq = readFileSync(
      join(process.cwd(), "supabase/migrations/20261028090000_recognise_matrix_tagiq.sql"),
      "utf8"
    );
    expect(tagiq.trimStart()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(tagiq.trimEnd()).toMatch(/commit;$/);
    expect(tagiq).toContain("like '%MATRIXIQ%'");
    expect(tagiq).toContain("like '%MATRIXTAGIQ%'");
    expect(tagiq).toContain("then '^[0-9]{12}$'");
    expect(tagiq).toContain("else '^[0-9]{15}$'");
  });

  it("applies the same rule in the database", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*\nbegin;/);
    expect(migration.trimEnd()).toMatch(/commit;$/);
    expect(migration).toContain("like '%MATRIXIQ%'");
    expect(migration).toContain("!~ public.stockpro_device_id_pattern(bin.name)");
    expect(migration).toContain("where requested.imei !~ '^([0-9]{15}|[0-9]{12})$'");
    expect(migration).toContain("and char_length(item.imei) = 12");
    expect(migration).not.toContain("!~ '^[0-9]{15}$'");
    expect(migration).toContain(
      "revoke all on function public.stockpro_device_id_pattern(text) from public, anon, authenticated;"
    );
  });

  it("translates the new messages", () => {
    expect(translateUiText("fr", "No valid 12-digit serial numbers found.")).toBe(
      "Aucun numéro de série valide de 12 chiffres trouvé."
    );
    expect(translateUiText("nl", `12-digit serial numbers are only accepted for MatrixIQ. Import blocked: ${SERIAL}`)).toBe(
      `Serienummers van 12 cijfers worden alleen voor MatrixIQ aanvaard. Import geblokkeerd: ${SERIAL}`
    );
  });
});
