// In-memory stand-in for @supabase/supabase-js used by the offline clone
// simulation. Production is read-only (any write fails the run); Staging
// enforces the real foreign keys, with their ON DELETE behaviour, and the
// dispatch packaging trigger.

import { writeFileSync } from "node:fs";
import {
  PRODUCTION_HOST,
  STAGING_HOST,
  productionSeed,
  stagingSeed,
} from "./seed.mjs";

// Real tables of the Staging schema (views left out), read from its OpenAPI.
const TABLES = [
  "accessory_bins", "accessory_movements", "alert_log", "alert_subscribers",
  "audit_events", "bins", "boxes", "connection_events",
  "device_accessory_templates", "device_inbound_accessories",
  "device_thresholds", "devices", "dispatch_batches",
  "dispatch_packaging_preferences", "dispatch_plan_assignments",
  "dispatch_plans", "inbound_batches", "inventory_command_receipts", "items",
  "movements", "nrd_schedules", "nrd_time_logs", "packaging_rules",
  "packaging_stock_movements", "packaging_types", "profiles",
  "return_history_entries", "return_records",
  "return_template_export_batches", "security_alert_recipients", "supplies",
  "supply_items", "supply_status_history", "user_permissions", "user_roles",
  "workload_budget_buckets", "workload_leases",
];

const PRIMARY_KEYS = {
  audit_events: ["audit_id"],
  device_thresholds: ["device"],
  devices: ["device_id"],
  dispatch_packaging_preferences: ["composition_key"],
  dispatch_plan_assignments: ["plan_id", "order_id"],
  inbound_batches: ["batch_id"],
  inventory_command_receipts: ["operation_id"],
  items: ["item_id"],
  movements: ["movement_id"],
  profiles: ["user_id"],
  return_history_entries: ["history_key"],
  security_alert_recipients: ["user_id"],
  user_permissions: ["user_id"],
  user_roles: ["user_id"],
  workload_budget_buckets: ["route_class"],
};
const primaryKey = (table) => PRIMARY_KEYS[table] || ["id"];

// [table, column, referenced table ("auth.users" for accounts), ON DELETE].
// From the Staging OpenAPI and supabase/migrations; "restrict" where the
// migration does not say otherwise, so the script's order must be right.
const FOREIGN_KEYS = [
  ["accessory_movements", "accessory_bin_id", "accessory_bins", "restrict"],
  ["boxes", "bin_id", "bins", "restrict"],
  ["device_accessory_templates", "device_id", "bins", "restrict"],
  ["device_accessory_templates", "accessory_bin_id", "accessory_bins", "restrict"],
  ["device_inbound_accessories", "device_id", "bins", "cascade"],
  ["device_inbound_accessories", "accessory_bin_id", "accessory_bins", "cascade"],
  ["dispatch_batches", "actor_id", "auth.users", "set null"],
  ["dispatch_batches", "undone_by_id", "auth.users", "set null"],
  ["dispatch_packaging_preferences", "packaging_type_id", "packaging_types", "restrict"],
  ["dispatch_packaging_preferences", "last_confirmed_batch_id", "dispatch_batches", "cascade"],
  ["dispatch_plan_assignments", "plan_id", "dispatch_plans", "cascade"],
  ["dispatch_plan_assignments", "assignee_id", "auth.users", "cascade"],
  ["dispatch_plans", "planner_id", "auth.users", "set null"],
  ["items", "device_id", "bins", "restrict"],
  ["items", "box_id", "boxes", "restrict"],
  ["items", "import_id", "inbound_batches", "restrict"],
  ["movements", "item_id", "items", "restrict"],
  ["movements", "device_id", "bins", "restrict"],
  ["nrd_schedules", "user_id", "auth.users", "cascade"],
  ["nrd_time_logs", "schedule_id", "nrd_schedules", "set null"],
  ["packaging_rules", "trigger_packaging_type_id", "packaging_types", "cascade"],
  ["packaging_rules", "trigger_device_id", "bins", "cascade"],
  ["packaging_rules", "packaging_type_id", "packaging_types", "cascade"],
  ["packaging_stock_movements", "packaging_type_id", "packaging_types", "restrict"],
  ["packaging_stock_movements", "actor_id", "auth.users", "set null"],
  ["packaging_types", "legacy_accessory_bin_id", "accessory_bins", "set null"],
  ["packaging_types", "created_by_id", "auth.users", "set null"],
  ["packaging_types", "updated_by_id", "auth.users", "set null"],
  ["profiles", "user_id", "auth.users", "cascade"],
  ["return_history_entries", "operation_id", "inventory_command_receipts", "restrict"],
  ["return_records", "movement_id", "movements", "restrict"],
  ["return_records", "item_id", "items", "restrict"],
  ["return_records", "device_id", "bins", "restrict"],
  ["return_records", "template_export_batch_id", "return_template_export_batches", "restrict"],
  ["security_alert_recipients", "user_id", "auth.users", "cascade"],
  ["supply_items", "supply_id", "supplies", "restrict"],
  ["supply_status_history", "supply_id", "supplies", "restrict"],
  ["user_permissions", "user_id", "auth.users", "cascade"],
  ["user_roles", "user_id", "auth.users", "cascade"],
];

// Columns the script fills itself (return history, permission defaults).
const EXTRA_COLUMNS = {
  return_history_entries: [
    "history_key", "operation_id", "created_at", "actor", "return_ref",
    "return_type", "return_reason", "qty",
  ],
  return_records: [
    "template_export_batch_id", "template_exported_at",
    "template_exported_by", "template_exported_by_email",
  ],
  user_permissions: [
    "can_dashboard", "can_inventory_export", "can_inbound", "can_outbound",
    "can_returns", "can_transfer", "can_labels", "can_bins",
    "can_accessories", "can_supply", "can_nrd", "can_admin",
  ],
};

const db = {
  [PRODUCTION_HOST]: productionSeed(),
  [STAGING_HOST]: stagingSeed(),
};
const seeds = [productionSeed(), stagingSeed()];
const columns = Object.fromEntries(
  TABLES.map((table) => [
    table,
    new Set([
      ...primaryKey(table),
      ...(EXTRA_COLUMNS[table] || []),
      ...seeds.flatMap((seed) =>
        (seed.tables[table] || []).flatMap((row) => Object.keys(row))
      ),
    ]),
  ])
);

export function definitionsFor(host) {
  if (!db[host]) return null;
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      {
        properties: Object.fromEntries(
          [...columns[table]].map((column) => [column, {}])
        ),
      },
    ])
  );
}

const productionWrites = [];
let idCounter = 0;

function rowsOf(env, table) {
  env.tables[table] ||= [];
  return env.tables[table];
}

function keyOf(table, row) {
  return primaryKey(table).map((column) => String(row[column])).join("|");
}

function checkParents(env, table, row) {
  for (const [child, column, parent] of FOREIGN_KEYS) {
    if (child !== table) continue;
    const value = row[column];
    if (value === null || value === undefined) continue;
    const exists =
      parent === "auth.users"
        ? env.users.some((user) => user.id === value)
        : rowsOf(env, parent).some(
            (candidate) => String(candidate[primaryKey(parent)[0]]) === String(value)
          );
    if (!exists) {
      return `insert or update on table "${table}" violates foreign key constraint on ${column}`;
    }
  }
  return null;
}

// Removes rows (or auth users) and applies ON DELETE to their children.
function removeParents(env, parent, removedRows) {
  const keyColumn = parent === "auth.users" ? "id" : primaryKey(parent)[0];
  const removedKeys = new Set(removedRows.map((row) => String(row[keyColumn])));
  if (removedKeys.size === 0) return null;
  for (const [child, column, target, onDelete] of FOREIGN_KEYS) {
    if (target !== parent) continue;
    const children = rowsOf(env, child).filter(
      (row) => row[column] !== null && row[column] !== undefined && removedKeys.has(String(row[column]))
    );
    if (children.length === 0) continue;
    if (onDelete === "restrict") {
      return `update or delete on table "${parent}" violates foreign key constraint on table "${child}"`;
    }
    if (onDelete === "set null") {
      for (const row of children) row[column] = null;
    } else {
      env.tables[child] = rowsOf(env, child).filter((row) => !children.includes(row));
      const error = removeParents(env, child, children);
      if (error) return error;
    }
  }
  return null;
}

// Mirrors dispatch_packaging_preferences_sync: a confirmed batch rebuilds the
// preference of each composition it holds.
function dispatchBatchTrigger(env, batch) {
  if (batch.status !== "CONFIRMED") return;
  for (const order of batch.orders || []) {
    if (!/^[a-f0-9]{64}$/.test(String(order.compositionKey || ""))) continue;
    if (!Array.isArray(order.packages) || order.packages.length !== 1) continue;
    const preferences = rowsOf(env, "dispatch_packaging_preferences");
    const rebuilt = {
      composition_key: order.compositionKey,
      composition: order.items || [],
      packaging_type_id: order.packages[0].packagingTypeId,
      package_quantity: order.packages[0].quantity,
      confirmation_count: 1,
      last_confirmed_batch_id: batch.id,
      last_actor_email: batch.actor_email,
      last_confirmed_at: batch.confirmed_at,
    };
    const index = preferences.findIndex((row) => row.composition_key === order.compositionKey);
    if (index >= 0) preferences[index] = rebuilt;
    else preferences.push(rebuilt);
  }
}

function refuseProduction(host, action) {
  if (host === PRODUCTION_HOST) {
    productionWrites.push(action);
    throw new Error(`Offline simulation: write to Production refused (${action})`);
  }
}

function query(host, env, table) {
  const state = { head: false, orders: [] };
  const sorted = () => {
    const rows = [...rowsOf(env, table)];
    rows.sort((a, b) => {
      for (const column of state.orders) {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        if (left !== right) return left < right ? -1 : 1;
      }
      return 0;
    });
    return rows;
  };
  const builder = {
    select(_columns, options) {
      state.head = Boolean(options?.head);
      return builder;
    },
    order(column) {
      state.orders.push(column);
      return builder;
    },
    range(from, to) {
      return Promise.resolve({ data: sorted().slice(from, to + 1), error: null });
    },
    then(resolve, reject) {
      const rows = rowsOf(env, table);
      return Promise.resolve({
        count: rows.length,
        data: state.head ? null : rows,
        error: null,
      }).then(resolve, reject);
    },
    delete() {
      refuseProduction(host, `delete ${table}`);
      return {
        not: async () => {
          const removed = [...rowsOf(env, table)];
          env.tables[table] = [];
          const error = removeParents(env, table, removed);
          return { error: error ? { message: error } : null };
        },
      };
    },
    insert: async (batch) => {
      refuseProduction(host, `insert ${table}`);
      const rows = rowsOf(env, table);
      for (const row of batch) {
        for (const column of Object.keys(row)) {
          if (!columns[table].has(column)) {
            return { error: { message: `column "${column}" of "${table}" does not exist` } };
          }
        }
        for (const column of primaryKey(table)) {
          if (row[column] === null || row[column] === undefined) {
            return { error: { message: `null value in column "${column}" of "${table}"` } };
          }
        }
        if (rows.some((existing) => keyOf(table, existing) === keyOf(table, row))) {
          return { error: { message: `duplicate key value violates unique constraint "${table}_pkey"` } };
        }
        const error = checkParents(env, table, row);
        if (error) return { error: { message: error } };
        rows.push(structuredClone(row));
        if (table === "dispatch_batches") dispatchBatchTrigger(env, row);
      }
      return { error: null };
    },
  };
  return builder;
}

export function createClient(url) {
  const host = new URL(url).hostname;
  const env = db[host];
  if (!env) throw new Error(`Offline simulation: unknown project ${host}`);
  return {
    from: (table) => query(host, env, table),
    auth: {
      admin: {
        listUsers: async ({ page = 1, perPage = 50 } = {}) => ({
          data: { users: env.users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        }),
        deleteUser: async (id) => {
          refuseProduction(host, "delete auth user");
          const removed = env.users.filter((user) => user.id === id);
          env.users = env.users.filter((user) => user.id !== id);
          const error = removeParents(env, "auth.users", removed);
          return { error: error ? { message: error } : null };
        },
        createUser: async (input) => {
          refuseProduction(host, "create auth user");
          idCounter += 1;
          const user = {
            id: `5c000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`,
            email: input.email,
            created_at: new Date(0).toISOString(),
            user_metadata: input.user_metadata,
            app_metadata: input.app_metadata,
          };
          env.users.push(user);
          return { data: { user }, error: null };
        },
      },
    },
    storage: { listBuckets: async () => ({ data: [], error: null }) },
  };
}

process.on("exit", () => {
  if (!process.env.CLONE_SIMULATION_STATE) return;
  writeFileSync(
    process.env.CLONE_SIMULATION_STATE,
    JSON.stringify({
      productionWrites,
      production: db[PRODUCTION_HOST],
      staging: db[STAGING_HOST],
    })
  );
});
