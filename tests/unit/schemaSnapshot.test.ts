import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSchemaSnapshot,
  latestMigration,
  snapshotLastMigration,
} from "../../scripts/lib/schema-snapshot.mjs";

const root = join(__dirname, "../..");
const snapshot = readFileSync(join(root, "supabase/schema/staging-schema.sql"), "utf8");

describe("committed schema snapshot", () => {
  it("reflects the latest migration (run `npm run db:schema` after applying a migration on Staging)", () => {
    const migrations = readdirSync(join(root, "supabase/migrations"));
    expect(snapshotLastMigration(snapshot)).toBe(latestMigration(migrations));
  });

  it("describes structure only and stays in the application schemas", () => {
    // Function bodies (between $function$ quotes) may insert rows; nothing else may.
    const outsideFunctionBodies = snapshot.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(outsideFunctionBodies).not.toMatch(/^\s*(INSERT INTO|COPY |UPDATE |DELETE FROM)/im);
    expect(snapshot).not.toMatch(/^CREATE (TABLE|OR REPLACE FUNCTION|OR REPLACE VIEW)[^\n]* (auth|storage|realtime|vault)\./m);
    expect(snapshot).toMatch(/^CREATE TABLE IF NOT EXISTS public\.items \(/m);
    expect(snapshot).toMatch(/^ALTER TABLE public\.items ENABLE ROW LEVEL SECURITY;$/m);
  });
});

describe("latestMigration", () => {
  it("orders short and long version prefixes like the Supabase CLI", () => {
    expect(
      latestMigration([
        "20261112100000_trace_accessory_stock_counts.sql",
        "20260716_harden_rls.sql",
        "20261106090000_restrict_device_thresholds.sql",
        "README.md",
      ])
    ).toBe("20261112100000_trace_accessory_stock_counts.sql");
    expect(latestMigration(["20260716_b.sql", "20260716_a.sql"])).toBe("20260716_b.sql");
    expect(latestMigration(["notes.txt"])).toBeNull();
  });
});

describe("buildSchemaSnapshot", () => {
  const meta = { projectName: "Test", generatedOn: "2026-11-12", lastMigration: "20261112100000_x.sql" };

  it("orders statements by section then key, whatever the input order", () => {
    const text = buildSchemaSnapshot({
      ...meta,
      rows: [
        { section: 92, sort_key: "public.b p", ddl: "CREATE POLICY p ON public.b;" },
        { section: 50, sort_key: "public.b", ddl: "CREATE TABLE IF NOT EXISTS public.b ();" },
        { section: 50, sort_key: "public.a", ddl: "CREATE TABLE IF NOT EXISTS public.a ();" },
        { section: 10, sort_key: "public", ddl: "CREATE SCHEMA IF NOT EXISTS public;" },
      ],
    });
    const order = ["CREATE SCHEMA", "public.a ()", "public.b ()", "CREATE POLICY"].map((part) => text.indexOf(part));
    expect(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1]))).toBe(true);
    expect(snapshotLastMigration(text)).toBe("20261112100000_x.sql");
    expect(text).toContain("--   Tables: 2");
    expect(text.endsWith(";\n")).toBe(true);
  });

  it("refuses an empty result or an unknown row instead of writing a broken file", () => {
    expect(() => buildSchemaSnapshot({ ...meta, rows: [] })).toThrow(/no rows/);
    expect(() => buildSchemaSnapshot({ ...meta, rows: [{ section: 12, sort_key: "x", ddl: "x" }] })).toThrow(/Unexpected/);
    expect(() =>
      buildSchemaSnapshot({ ...meta, generatedOn: "today", rows: [{ section: 10, sort_key: "x", ddl: "x" }] })
    ).toThrow(/date/);
  });
});
