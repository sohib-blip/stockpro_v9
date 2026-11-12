import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  PEOPLE,
  PRODUCTION_IDS,
  REAL_STRINGS,
  productionSeed,
  stagingSeed,
} from "../fixtures/clone-simulation/seed.mjs";

// Runs the real clone script offline: @supabase/supabase-js is replaced by
// in-memory fake projects (Production read-only, Staging with the real
// foreign keys and dispatch trigger) and every network call is refused.

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/clone-production-data-to-staging.mjs");
const REGISTER = join(ROOT, "tests/fixtures/clone-simulation/register.mjs");
const workDirectories: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form JSON rows of the fake projects
type Row = Record<string, any>;
type SimulationState = {
  productionWrites: string[];
  production: { users: Row[]; tables: Record<string, Row[]> };
  staging: { users: Row[]; tables: Record<string, Row[]> };
};

function runScript(command: string) {
  const directory = mkdtempSync(join(tmpdir(), "stockpro-clone-sim-"));
  workDirectories.push(directory);
  writeFileSync(
    join(directory, ".env.local"),
    "NEXT_PUBLIC_SUPABASE_URL=https://tqoblbwvvvqmwlsfoxni.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=fake-production-key\n"
  );
  writeFileSync(
    join(directory, ".env.e2e.local"),
    "E2E_SUPABASE_URL=https://enjusebvcfjudrrnvjgl.supabase.co\nE2E_SUPABASE_SERVICE_ROLE_KEY=fake-staging-key\n"
  );
  const statePath = join(directory, "state.json");
  const result = spawnSync(
    process.execPath,
    ["--import", REGISTER, SCRIPT, command],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, CLONE_SIMULATION_STATE: statePath },
      timeout: 60_000,
    }
  );
  const state = JSON.parse(readFileSync(statePath, "utf8")) as SimulationState;
  const cloneDirectory = join(directory, ".stockpro-local", "data-clone");
  let files: Record<string, string> = {};
  try {
    files = Object.fromEntries(
      readdirSync(cloneDirectory).map((name) => [
        name,
        readFileSync(join(cloneDirectory, name), "utf8"),
      ])
    );
  } catch {
    files = {};
  }
  return { result, state, files, output: `${result.stdout}\n${result.stderr}` };
}

function expectNoRealData(value: unknown, label: string) {
  const text = JSON.stringify(value).toLowerCase();
  for (const real of REAL_STRINGS) {
    expect(text, `${label}: ${real}`).not.toContain(real.toLowerCase());
  }
  expect(text, label).not.toMatch(/@(?!stockpro\.test)[a-z0-9-]+\.[a-z]/);
}

afterAll(() => {
  for (const directory of workDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const COPIED = [
  "bins",
  "accessory_bins",
  "device_thresholds",
  "packaging_types",
  "packaging_rules",
  "device_inbound_accessories",
  "alert_subscribers",
  "inbound_batches",
  "boxes",
  "profiles",
  "user_roles",
  "user_permissions",
  "security_alert_recipients",
  "items",
  "supplies",
  "supply_status_history",
  "movements",
  "return_records",
  "accessory_movements",
  "packaging_stock_movements",
  "nrd_schedules",
  "nrd_time_logs",
  "dispatch_batches",
  "dispatch_packaging_preferences",
];
const CLEARED_ONLY = [
  "dispatch_plans",
  "dispatch_plan_assignments",
  "audit_events",
  "alert_log",
  "connection_events",
  "workload_leases",
];

describe("clone script, offline simulation: apply", () => {
  const run = runScript("apply");
  const staging = run.state.staging;
  const tables = staging.tables;
  const production = productionSeed().tables as Record<string, Row[]>;
  const stagingUserIds = new Set(staging.users.map((user) => user.id));

  it("completes without touching Production", () => {
    expect(run.result.status, run.output).toBe(0);
    expect(run.state.productionWrites).toEqual([]);
    expect(run.state.production).toEqual(productionSeed());
  });

  it("copies every business table, the new ones included", () => {
    for (const table of COPIED) {
      expect(tables[table]?.length, table).toBe(production[table].length);
    }
  });

  it("only clears today's dispatch plan, legacy and technical tables", () => {
    for (const table of CLEARED_ONLY) {
      expect(tables[table] || [], table).toEqual([]);
    }
  });

  it("replaces the old Staging test data and accounts", () => {
    const oldStaging = stagingSeed();
    expect(staging.users.map((user) => user.email)).not.toContain(
      "picker1@stockpro.test"
    );
    expect(staging.users).toHaveLength(productionSeed().users.length);
    const oldTypeIds = oldStaging.tables.packaging_types.map((row: Row) => row.id);
    for (const row of tables.packaging_types) {
      expect(oldTypeIds).not.toContain(row.id);
    }
  });

  it("points every copied user link to a cloned Staging account", () => {
    const links: Array<[string, string]> = [
      ["nrd_schedules", "user_id"],
      ["nrd_time_logs", "user_id"],
      ["security_alert_recipients", "user_id"],
      ["packaging_types", "created_by_id"],
      ["packaging_types", "updated_by_id"],
      ["packaging_stock_movements", "actor_id"],
      ["dispatch_batches", "actor_id"],
    ];
    for (const [table, column] of links) {
      for (const row of tables[table]) {
        expect(stagingUserIds.has(row[column]), `${table}.${column}`).toBe(true);
      }
    }
    expect(tables.nrd_time_logs[0].schedule_id).toBe(PRODUCTION_IDS.schedule);
  });

  it("keeps the business data readable for demos", () => {
    const [type] = tables.packaging_types;
    expect(type).toMatchObject({
      code: "BOX-S",
      name: "Small box",
      on_hand_stock: 120,
      legacy_accessory_bin_id: "a2",
    });
    expect(type.created_by_email).toMatch(/^user-[0-9a-f]{10}@stockpro\.test$/);
    expect(tables.device_thresholds).toEqual(production.device_thresholds);
    expect(tables.device_inbound_accessories).toEqual(production.device_inbound_accessories);

    const [batch] = tables.dispatch_batches;
    const [order] = batch.orders;
    expect(order.companyName).toMatch(/^Customer [0-9a-f]{10}$/);
    expect(order.companyName).toBe(tables.return_records[0].customer);
    expect(order.items).toEqual(production.dispatch_batches[0].orders[0].items);
    expect(order.packages).toEqual(production.dispatch_batches[0].orders[0].packages);
    expect(batch.package_usage).toEqual(production.dispatch_batches[0].package_usage);
    expect(batch.source_filename).toMatch(/^Dispatch file [0-9a-f]{10}$/);

    const reasons = tables.packaging_stock_movements.map((row) => row.reason);
    expect(reasons[0]).toBe(`Daily dispatch ${batch.source_filename}`);
    expect(reasons[1]).toBe("Stock count updated in Packaging Inventory");
    expect(reasons[2]).toBe("[redacted]");

    expect(tables.nrd_schedules[0].task).toBe(tables.nrd_time_logs[0].task);
    expect(tables.nrd_schedules[0].task).toMatch(/^Task [0-9a-f]{10}$/);
  });

  it("copies the learned packaging exactly, not the trigger's rebuild", () => {
    expect(tables.dispatch_packaging_preferences).toHaveLength(1);
    expect(tables.dispatch_packaging_preferences[0]).toMatchObject({
      composition_key: PRODUCTION_IDS.compositionKey,
      confirmation_count: 3,
      last_confirmed_batch_id: PRODUCTION_IDS.batch,
    });
  });

  it("lets no real person, email, customer or plate reach Staging or the disk", () => {
    expectNoRealData(staging, "Staging");
    expect(Object.keys(run.files).length).toBeGreaterThanOrEqual(4);
    for (const [name, content] of Object.entries(run.files)) {
      expectNoRealData(content, name);
    }
    expect(JSON.stringify(run.files)).not.toContain(PEOPLE.registration);
  });
});

describe("clone script, offline simulation: clear-staging", () => {
  const run = runScript("clear-staging");

  it("empties every Staging table and account without touching Production", () => {
    expect(run.result.status, run.output).toBe(0);
    expect(run.state.productionWrites).toEqual([]);
    expect(run.state.staging.users).toEqual([]);
    for (const [table, rows] of Object.entries(run.state.staging.tables)) {
      expect(rows, table).toEqual([]);
    }
  });

  it("writes only a pseudonymized backup", () => {
    const names = Object.keys(run.files);
    expect(names).toHaveLength(1);
    const backup = JSON.parse(run.files[names[0]]);
    expect(backup.tables).toHaveProperty("dispatch_plans");
    expect(backup.tables).not.toHaveProperty("audit_events");
    expect(backup.tables).not.toHaveProperty("connection_events");
    expect(backup.tables.dispatch_plan_assignments[0].assignee_email).toBe(
      "picker1@stockpro.test"
    );
  });
});
