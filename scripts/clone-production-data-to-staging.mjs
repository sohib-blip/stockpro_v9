import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "tqoblbwvvvqmwlsfoxni";
const STAGING_PROJECT_REF = "enjusebvcfjudrrnvjgl";
const PAGE_SIZE = 1_000;
const INSERT_BATCH_SIZE = 500;

const TABLE_CANDIDATES = [
  "accessory_bins",
  "accessory_movements",
  "alert_subscribers",
  "alerts",
  "app_sessions",
  "bins",
  "boxes",
  "connection_events",
  "device_accessory_templates",
  "devices",
  "inbound_batches",
  "inventory_command_receipts",
  "items",
  "movements",
  "nrd_time_logs",
  "profiles",
  "return_history_entries",
  "return_records",
  "return_template_export_batches",
  "supplies",
  "supply_items",
  "supply_status_history",
  "user_permissions",
  "user_roles",
  "workload_budget_buckets",
  "workload_leases",
];

const COPY_ORDER = [
  "bins",
  "accessory_bins",
  "alert_subscribers",
  "inbound_batches",
  "boxes",
  "device_accessory_templates",
  "profiles",
  "user_roles",
  "user_permissions",
  "items",
  "supplies",
  "supply_items",
  "supply_status_history",
  "movements",
  "return_records",
  "accessory_movements",
  "nrd_time_logs",
];

const LEGACY_PRODUCTION_SNAPSHOT_TABLES = [
  "stock_count_scans",
  "stock_counts",
  "inbound_import_boxes",
  "inbound_import_log_boxes",
  "inbound_imports_log",
  "inbound_import_logs",
  "inbound_imports",
  "device_aliases",
  "box_movements",
  "device_stock",
  "imeis",
  "import_batches",
  "outbound_batches",
];

const DELETE_ORDER = [
  "return_records",
  "return_template_export_batches",
  "return_history_entries",
  "app_sessions",
  "workload_leases",
  "workload_budget_buckets",
  "connection_events",
  "inventory_command_receipts",
  "alerts",
  "accessory_movements",
  "device_accessory_templates",
  "supply_status_history",
  "supply_items",
  "supplies",
  "movements",
  "items",
  "boxes",
  "inbound_batches",
  "nrd_time_logs",
  "user_permissions",
  "user_roles",
  "profiles",
  "alert_subscribers",
  "accessory_bins",
  "bins",
  "devices",
];

const PRIMARY_KEYS = {
  accessory_bins: "id",
  accessory_movements: "id",
  alert_subscribers: "id",
  alerts: "id",
  app_sessions: "user_id",
  bins: "id",
  boxes: "id",
  connection_events: "id",
  device_accessory_templates: "id",
  devices: "device_id",
  inbound_batches: "batch_id",
  inventory_command_receipts: "operation_id",
  items: "item_id",
  movements: "movement_id",
  nrd_time_logs: "id",
  profiles: "user_id",
  return_history_entries: "history_key",
  return_records: "id",
  return_template_export_batches: "id",
  supplies: "id",
  supply_items: "id",
  supply_status_history: "id",
  user_permissions: "user_id",
  user_roles: "user_id",
  workload_budget_buckets: "route_class",
  workload_leases: "id",
};

const OUTPUT_DIRECTORY = resolve(
  process.cwd(),
  ".stockpro-local",
  "data-clone"
);

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function loadEnvironment(path, urlKey, serviceRoleKeyName) {
  const parsed = parseEnv(await readFile(resolve(process.cwd(), path), "utf8"));
  const url = parsed[urlKey];
  const serviceRoleKey = parsed[serviceRoleKeyName];
  if (!url || !serviceRoleKey) {
    throw new Error(`Missing Supabase credentials in ${path}`);
  }
  return { url, serviceRoleKey };
}

function assertProject(environment, expectedRef, label) {
  const target = new URL(environment.url);
  if (
    target.protocol !== "https:" ||
    target.hostname !== `${expectedRef}.supabase.co`
  ) {
    throw new Error(
      `${label} safety stop: expected ${expectedRef}.supabase.co, received ${target.hostname}`
    );
  }
}

function client(environment) {
  return createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function context() {
  const production = await loadEnvironment(
    ".env.local",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const staging = await loadEnvironment(
    ".env.e2e.local",
    "E2E_SUPABASE_URL",
    "E2E_SUPABASE_SERVICE_ROLE_KEY"
  );
  assertProject(production, PRODUCTION_PROJECT_REF, "Production");
  assertProject(staging, STAGING_PROJECT_REF, "Staging");
  if (production.url === staging.url) {
    throw new Error("Safety stop: Production and Staging URLs are identical");
  }
  return {
    production,
    staging,
    productionClient: client(production),
    stagingClient: client(staging),
  };
}

async function readOpenApi(environment) {
  const response = await fetch(`${environment.url}/rest/v1/`, {
    headers: {
      apikey: environment.serviceRoleKey,
      Authorization: `Bearer ${environment.serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Read ${environment.url} OpenAPI: ${response.status}`);
  }
  const document = await response.json();
  return document.definitions || {};
}

async function listAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: PAGE_SIZE,
    });
    if (error) throw error;
    users.push(...(data?.users || []));
    if ((data?.users || []).length < PAGE_SIZE) break;
  }
  return users;
}

async function countRows(supabase, table) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count: Number(count || 0), error: null };
}

async function readAllRows(supabase, table) {
  const rows = [];
  const primaryKey = PRIMARY_KEYS[table];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select("*");
    if (primaryKey) query = query.order(primaryKey, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Read ${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  return rows;
}

function columnsFor(definitions, table) {
  return Object.keys(definitions[table]?.properties || {}).sort();
}

function safeAuthUser(user) {
  return {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    email_confirmed_at: user.email_confirmed_at || null,
    phone_confirmed_at: user.phone_confirmed_at || null,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_sign_in_at: user.last_sign_in_at || null,
    app_metadata: user.app_metadata || {},
    user_metadata: user.user_metadata || {},
    banned_until: user.banned_until || null,
  };
}

async function readSnapshot(
  label,
  environment,
  supabase,
  definitions,
  tables
) {
  const tableData = {};
  for (const table of tables) {
    if (!definitions[table]) continue;
    tableData[table] = await readAllRows(supabase, table);
    console.log(`${label}: read ${tableData[table].length} ${table}`);
  }
  const users = (await listAuthUsers(supabase)).map(safeAuthUser);
  const { data: buckets, error: bucketError } =
    await supabase.storage.listBuckets();
  if (bucketError) throw new Error(`${label} storage: ${bucketError.message}`);
  return {
    createdAt: new Date().toISOString(),
    projectRef:
      label === "Production"
        ? PRODUCTION_PROJECT_REF
        : STAGING_PROJECT_REF,
    authUsers: users,
    storageBuckets: buckets || [],
    tables: tableData,
  };
}

async function writeArtifact(name, value) {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const path = resolve(OUTPUT_DIRECTORY, name);
  await writeFile(path, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  return path;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function inventory() {
  const {
    production,
    staging,
    productionClient,
    stagingClient,
  } = await context();
  const [
    productionDefinitions,
    stagingDefinitions,
    productionUsers,
    stagingUsers,
    productionBuckets,
    stagingBuckets,
  ] = await Promise.all([
    readOpenApi(production),
    readOpenApi(staging),
    listAuthUsers(productionClient),
    listAuthUsers(stagingClient),
    productionClient.storage.listBuckets(),
    stagingClient.storage.listBuckets(),
  ]);

  if (productionBuckets.error) throw productionBuckets.error;
  if (stagingBuckets.error) throw stagingBuckets.error;

  const availableTables = TABLE_CANDIDATES.filter(
    (table) => productionDefinitions[table] || stagingDefinitions[table]
  );
  const rows = [];
  for (const table of availableTables) {
    const productionHasTable = Boolean(productionDefinitions[table]);
    const stagingHasTable = Boolean(stagingDefinitions[table]);
    const [productionCount, stagingCount] = await Promise.all([
      productionHasTable
        ? countRows(productionClient, table)
        : { count: null, error: "table absent" },
      stagingHasTable
        ? countRows(stagingClient, table)
        : { count: null, error: "table absent" },
    ]);
    const productionColumns = columnsFor(productionDefinitions, table);
    const stagingColumns = columnsFor(stagingDefinitions, table);
    rows.push({
      table,
      production: productionCount,
      staging: stagingCount,
      productionColumns,
      stagingColumns,
      onlyInProduction: productionColumns.filter(
        (column) => !stagingColumns.includes(column)
      ),
      onlyInStaging: stagingColumns.filter(
        (column) => !productionColumns.includes(column)
      ),
    });
  }

  const outputPath = await writeArtifact(`inventory-${stamp()}.json`, {
    createdAt: new Date().toISOString(),
    productionProjectRef: PRODUCTION_PROJECT_REF,
    stagingProjectRef: STAGING_PROJECT_REF,
    auth: {
      production: productionUsers.map(safeAuthUser),
      staging: stagingUsers.map(safeAuthUser),
    },
    storage: {
      production: productionBuckets.data || [],
      staging: stagingBuckets.data || [],
    },
    tables: rows,
  });

  console.table(
    rows.map((row) => ({
      table: row.table,
      production: row.production.count ?? row.production.error,
      staging: row.staging.count ?? row.staging.error,
      production_only_columns: row.onlyInProduction.length,
      staging_only_columns: row.onlyInStaging.length,
    }))
  );
  console.log(
    `Auth users: Production ${productionUsers.length}, Staging ${stagingUsers.length}`
  );
  console.log(
    `Storage buckets: Production ${(productionBuckets.data || []).length}, Staging ${(stagingBuckets.data || []).length}`
  );
  console.log(`Inventory written to ${outputPath}`);
}

async function backup() {
  const { staging, stagingClient } = await context();
  const stagingDefinitions = await readOpenApi(staging);
  const snapshot = await readSnapshot(
    "Staging",
    staging,
    stagingClient,
    stagingDefinitions,
    TABLE_CANDIDATES
  );
  const outputPath = await writeArtifact(
    `staging-backup-${stamp()}.json`,
    snapshot
  );
  console.log(`Staging backup written to ${outputPath}`);
  return { outputPath, snapshot };
}

async function snapshotProduction() {
  const { production, productionClient } = await context();
  const productionDefinitions = await readOpenApi(production);
  const snapshot = await readSnapshot(
    "Production",
    production,
    productionClient,
    productionDefinitions,
    [...COPY_ORDER, ...LEGACY_PRODUCTION_SNAPSHOT_TABLES]
  );
  const outputPath = await writeArtifact(
    `production-snapshot-${stamp()}.json`,
    snapshot
  );
  console.log(`Production snapshot written to ${outputPath}`);
  return { outputPath, snapshot };
}

async function deleteAllRows(supabase, definitions, table) {
  if (!definitions[table]) return;
  const primaryKey = PRIMARY_KEYS[table];
  if (!primaryKey) throw new Error(`No safe delete key registered for ${table}`);
  const { error } = await supabase
    .from(table)
    .delete()
    .not(primaryKey, "is", null);
  if (error) throw new Error(`Clear ${table}: ${error.message}`);
  console.log(`Staging: cleared ${table}`);
}

async function insertRows(supabase, table, rows) {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      throw new Error(
        `Insert ${table} rows ${offset + 1}-${offset + batch.length}: ${error.message}`
      );
    }
  }
  console.log(`Staging: inserted ${rows.length} ${table}`);
}

function roleDefaults(role) {
  const enabled = role === "admin" || role === "operator";
  return {
    can_dashboard: true,
    can_inventory_export: enabled,
    can_inbound: enabled,
    can_outbound: enabled,
    can_returns: enabled,
    can_transfer: enabled,
    can_labels: enabled,
    can_bins: enabled,
    can_accessories: enabled,
    can_supply: enabled,
    can_nrd: enabled,
    can_admin: role === "admin",
  };
}

function remapId(value, userIdMap) {
  if (!value) return null;
  return userIdMap.get(String(value)) || null;
}

function transformRows(
  table,
  rows,
  stagingDefinitions,
  userIdMap,
  productionRoles
) {
  const acceptedColumns = new Set(columnsFor(stagingDefinitions, table));
  return rows.map((sourceRow) => {
    const row = Object.fromEntries(
      Object.entries(sourceRow).filter(([column]) =>
        acceptedColumns.has(column)
      )
    );

    if (table === "profiles") {
      row.user_id = remapId(row.user_id, userIdMap);
      row.current_session_id = null;
      row.last_seen_at = null;
    }
    if (table === "user_roles") {
      row.user_id = remapId(row.user_id, userIdMap);
    }
    if (table === "user_permissions") {
      const sourceUserId = String(row.user_id || "");
      row.user_id = remapId(sourceUserId, userIdMap);
      Object.assign(
        row,
        roleDefaults(productionRoles.get(sourceUserId) || "viewer"),
        {
          can_dashboard: row.can_dashboard === true,
          can_inbound: row.can_inbound === true,
          can_outbound: row.can_outbound === true,
          can_transfer: row.can_transfer === true,
          can_labels: row.can_labels === true,
          can_bins: row.can_bins === true,
        }
      );
      if (productionRoles.get(sourceUserId) === "admin") {
        Object.assign(row, roleDefaults("admin"));
      }
    }
    if (table === "nrd_time_logs") {
      row.user_id = remapId(row.user_id, userIdMap);
    }
    if (table === "accessory_movements") {
      row.actor_id = remapId(row.actor_id, userIdMap);
    }
    if (table === "movements") {
      row.actor_id = remapId(row.actor_id, userIdMap);
      row.created_by = remapId(row.created_by, userIdMap);
    }
    if (table === "return_records") {
      row.actor_id = remapId(row.actor_id, userIdMap);
      // Export bookkeeping is environment-specific. Every cloned return is a
      // fresh Staging export candidate, regardless of Production downloads.
      row.template_export_batch_id = null;
      row.template_exported_at = null;
      row.template_exported_by = null;
      row.template_exported_by_email = null;
    }
    if (table === "supplies") {
      row.created_by_id = remapId(row.created_by_id, userIdMap);
    }
    if (table === "supply_status_history") {
      row.changed_by_id = remapId(row.changed_by_id, userIdMap);
    }
    return row;
  });
}

function buildReturnHistory(movements) {
  const groups = new Map();
  for (const movement of movements) {
    if (String(movement.type || "").toUpperCase() !== "RETURN") continue;
    const historyKey = String(
      movement.operation_id ||
        movement.shipment_ref ||
        movement.movement_id
    );
    if (!groups.has(historyKey)) groups.set(historyKey, []);
    groups.get(historyKey).push(movement);
  }

  return Array.from(groups, ([historyKey, rows]) => {
    const ordered = [...rows].sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || ""))
    );
    const latest = ordered.at(-1) || {};
    return {
      history_key: historyKey,
      operation_id: null,
      created_at: latest.created_at,
      actor: latest.actor || "unknown",
      return_ref: latest.shipment_ref || "",
      return_type: latest.return_type || "",
      return_reason: latest.return_reason || "",
      qty: rows.length,
    };
  });
}

async function createStagingUsers(
  stagingClient,
  productionUsers,
  outputStamp
) {
  const userIdMap = new Map();
  const credentials = [];

  for (const user of productionUsers) {
    if (!user.email) {
      throw new Error(
        `Cannot clone Production auth user ${user.id}: email is missing`
      );
    }
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const { data, error } = await stagingClient.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      app_metadata: user.app_metadata || {},
      user_metadata: user.user_metadata || {},
    });
    if (error || !data.user) {
      throw new Error(
        `Create Staging auth user ${user.email}: ${error?.message || "no user returned"}`
      );
    }
    userIdMap.set(user.id, data.user.id);
    credentials.push({
      production_user_id: user.id,
      staging_user_id: data.user.id,
      email: user.email,
      temporary_password: password,
      password_reset_required: true,
    });
  }

  const credentialsPath = await writeArtifact(
    `staging-temporary-credentials-${outputStamp}.json`,
    credentials
  );
  return { userIdMap, credentialsPath };
}

async function cloneProductionToStaging() {
  const {
    production,
    staging,
    productionClient,
    stagingClient,
  } = await context();
  const [productionDefinitions, stagingDefinitions] = await Promise.all([
    readOpenApi(production),
    readOpenApi(staging),
  ]);

  for (const table of COPY_ORDER) {
    if (!productionDefinitions[table] || !stagingDefinitions[table]) {
      throw new Error(
        `Schema safety stop: ${table} must exist in both Production and Staging`
      );
    }
  }

  const outputStamp = stamp();
  const stagingBackup = await readSnapshot(
    "Staging backup",
    staging,
    stagingClient,
    stagingDefinitions,
    TABLE_CANDIDATES
  );
  const stagingBackupPath = await writeArtifact(
    `staging-backup-${outputStamp}.json`,
    stagingBackup
  );

  const productionSnapshot = await readSnapshot(
    "Production",
    production,
    productionClient,
    productionDefinitions,
    COPY_ORDER
  );
  const productionSnapshotPath = await writeArtifact(
    `production-snapshot-${outputStamp}.json`,
    productionSnapshot
  );
  console.log(`Staging backup: ${stagingBackupPath}`);
  console.log(`Production snapshot: ${productionSnapshotPath}`);

  if ((productionSnapshot.storageBuckets || []).length > 0) {
    throw new Error(
      "Safety stop: Production contains Storage buckets; object cloning must be reviewed before clearing Staging"
    );
  }

  for (const table of DELETE_ORDER) {
    await deleteAllRows(stagingClient, stagingDefinitions, table);
  }
  const stagingUsers = await listAuthUsers(stagingClient);
  for (const user of stagingUsers) {
    const { error } = await stagingClient.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Delete Staging user ${user.id}: ${error.message}`);
  }
  console.log(`Staging: deleted ${stagingUsers.length} auth users`);

  const { userIdMap, credentialsPath } = await createStagingUsers(
    stagingClient,
    productionSnapshot.authUsers,
    outputStamp
  );
  console.log(
    `Staging: created ${userIdMap.size} Production users with temporary passwords`
  );

  const productionRoles = new Map(
    (productionSnapshot.tables.user_roles || []).map((row) => [
      String(row.user_id),
      String(row.role || "viewer"),
    ])
  );

  const expectedCounts = {};
  for (const table of COPY_ORDER) {
    const transformed = transformRows(
      table,
      productionSnapshot.tables[table] || [],
      stagingDefinitions,
      userIdMap,
      productionRoles
    );
    await insertRows(stagingClient, table, transformed);
    expectedCounts[table] = transformed.length;
  }

  const returnHistory = buildReturnHistory(
    productionSnapshot.tables.movements || []
  );
  await insertRows(stagingClient, "return_history_entries", returnHistory);
  expectedCounts.return_history_entries = returnHistory.length;

  const verification = [];
  for (const [table, expected] of Object.entries(expectedCounts)) {
    const result = await countRows(stagingClient, table);
    if (result.error || result.count !== expected) {
      throw new Error(
        `Verify ${table}: expected ${expected}, received ${result.count ?? result.error}`
      );
    }
    verification.push({ table, expected, actual: result.count });
  }

  for (const table of [
    "connection_events",
    "inventory_command_receipts",
    "return_template_export_batches",
    "workload_budget_buckets",
    "workload_leases",
  ]) {
    if (!stagingDefinitions[table]) continue;
    const result = await countRows(stagingClient, table);
    if (result.error || result.count !== 0) {
      throw new Error(
        `Verify cleared ${table}: received ${result.count ?? result.error}`
      );
    }
    verification.push({ table, expected: 0, actual: 0 });
  }

  const clonedUsers = await listAuthUsers(stagingClient);
  if (clonedUsers.length !== productionSnapshot.authUsers.length) {
    throw new Error(
      `Verify auth users: expected ${productionSnapshot.authUsers.length}, received ${clonedUsers.length}`
    );
  }

  const reportPath = await writeArtifact(
    `clone-report-${outputStamp}.json`,
    {
      completedAt: new Date().toISOString(),
      productionProjectRef: PRODUCTION_PROJECT_REF,
      stagingProjectRef: STAGING_PROJECT_REF,
      productionWasReadOnly: true,
      stagingBackupPath,
      productionSnapshotPath,
      credentialsPath,
      authUsers: clonedUsers.length,
      verification,
    }
  );

  console.table(verification);
  console.log(`Temporary credentials: ${credentialsPath}`);
  console.log(`Clone report: ${reportPath}`);
}

async function clearStagingTechnicalState() {
  const { staging, stagingClient } = await context();
  const stagingDefinitions = await readOpenApi(staging);
  for (const table of [
    "workload_leases",
    "workload_budget_buckets",
    "connection_events",
    "inventory_command_receipts",
  ]) {
    await deleteAllRows(stagingClient, stagingDefinitions, table);
  }
  console.log("Staging technical test state cleared");
}

async function clearAllStagingData() {
  const { staging, stagingClient } = await context();
  const stagingDefinitions = await readOpenApi(staging);
  const outputStamp = stamp();
  const stagingBackup = await readSnapshot(
    "Staging backup before full clear",
    staging,
    stagingClient,
    stagingDefinitions,
    TABLE_CANDIDATES
  );
  const stagingBackupPath = await writeArtifact(
    `staging-backup-before-clear-${outputStamp}.json`,
    stagingBackup
  );

  if ((stagingBackup.storageBuckets || []).length > 0) {
    throw new Error(
      "Safety stop: Staging contains Storage buckets; object deletion must be reviewed separately"
    );
  }

  console.log(`Staging backup before clear: ${stagingBackupPath}`);
  for (const table of DELETE_ORDER) {
    await deleteAllRows(stagingClient, stagingDefinitions, table);
  }

  const stagingUsers = await listAuthUsers(stagingClient);
  for (const user of stagingUsers) {
    const { error } = await stagingClient.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Delete Staging user ${user.id}: ${error.message}`);
  }

  const verification = [];
  for (const table of TABLE_CANDIDATES) {
    if (!stagingDefinitions[table]) continue;
    const result = await countRows(stagingClient, table);
    if (result.error || result.count !== 0) {
      throw new Error(
        `Verify empty Staging ${table}: received ${result.count ?? result.error}`
      );
    }
    verification.push({ table, rows: 0 });
  }

  const remainingUsers = await listAuthUsers(stagingClient);
  if (remainingUsers.length !== 0) {
    throw new Error(
      `Verify empty Staging auth: received ${remainingUsers.length} users`
    );
  }

  console.table(verification);
  console.log(`Staging: deleted ${stagingUsers.length} auth users`);
  console.log("Staging business and technical data cleared; Production was read-only");
}

function sessionIdFromToken(accessToken) {
  const payload = JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")
  );
  const sessionId = String(payload.session_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new Error("Staging login did not return a signed session identifier");
  }
  return sessionId;
}

async function latestCredentials() {
  const files = (await readdir(OUTPUT_DIRECTORY))
    .filter((name) => name.startsWith("staging-temporary-credentials-"))
    .sort();
  const name = files.at(-1);
  if (!name) throw new Error("No cloned Staging credentials were found");
  return JSON.parse(await readFile(resolve(OUTPUT_DIRECTORY, name), "utf8"));
}

async function rotateStagingCredentials() {
  const { stagingClient } = await context();
  const users = await listAuthUsers(stagingClient);
  const credentials = [];
  for (const user of users) {
    if (!user.email) {
      throw new Error(`Cannot rotate Staging user ${user.id}: email is missing`);
    }
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const { data, error } = await stagingClient.auth.admin.updateUserById(
      user.id,
      { password }
    );
    if (error || !data.user) {
      throw new Error(
        `Rotate Staging user ${user.id}: ${error?.message || "no user returned"}`
      );
    }
    credentials.push({
      staging_user_id: user.id,
      email: user.email,
      temporary_password: password,
      password_reset_required: true,
    });
  }
  const credentialsPath = await writeArtifact(
    `staging-temporary-credentials-${stamp()}.json`,
    credentials
  );
  console.log(
    `Rotated ${credentials.length} Staging temporary passwords: ${credentialsPath}`
  );
}

async function verifyClonedAdmin() {
  const { staging, stagingClient } = await context();
  const [{ data: adminRole, error: roleError }, credentials] =
    await Promise.all([
      stagingClient
        .from("user_roles")
        .select("user_id,role")
        .eq("role", "admin")
        .single(),
      latestCredentials(),
    ]);
  if (roleError || !adminRole) {
    throw new Error(`Read cloned admin role: ${roleError?.message || "missing"}`);
  }
  const credential = credentials.find(
    (entry) => entry.staging_user_id === adminRole.user_id
  );
  if (!credential) throw new Error("Cloned admin credential is missing");

  const { data: login, error: loginError } =
    await stagingClient.auth.signInWithPassword({
      email: credential.email,
      password: credential.temporary_password,
    });
  if (loginError || !login.session || !login.user) {
    throw new Error(`Cloned admin login failed: ${loginError?.message}`);
  }
  if (login.user.id !== adminRole.user_id) {
    throw new Error("Cloned admin login returned the wrong user");
  }

  const sessionId = sessionIdFromToken(login.session.access_token);
  const serviceClient = client(staging);
  const { data: activation, error: activationError } = await serviceClient.rpc(
    "activate_app_session",
    {
      p_user_id: login.user.id,
      p_session_id: sessionId,
      p_email: credential.email,
    }
  );
  if (activationError || activation !== "activated") {
    throw new Error(
      `Cloned admin session activation failed: ${activationError?.message || activation}`
    );
  }

  try {
    const response = await fetch(
      `${staging.url}/rest/v1/user_roles?select=user_id,role`,
      {
        headers: {
          apikey: staging.serviceRoleKey,
          Authorization: `Bearer ${login.session.access_token}`,
        },
      }
    );
    const roles = await response.json();
    if (
      response.status !== 200 ||
      roles.length !== 1 ||
      roles[0].user_id !== login.user.id ||
      roles[0].role !== "admin"
    ) {
      throw new Error("Cloned admin RLS verification failed");
    }
  } finally {
    const { data: ended, error: endError } = await serviceClient.rpc(
      "end_app_session",
      {
        p_user_id: login.user.id,
        p_session_id: sessionId,
      }
    );
    await stagingClient.auth.signOut();
    if (endError || ended !== true) {
      throw new Error(
        `Cloned admin logout failed: ${endError?.message || ended}`
      );
    }
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("current_session_id")
      .eq("user_id", login.user.id)
      .single();
    if (profileError || profile?.current_session_id !== null) {
      throw new Error("Cloned admin session was not closed cleanly");
    }
  }

  console.log(
    "Cloned Production admin login, signed session, RLS and logout verified on Staging"
  );
}

const command = process.argv[2] || "inventory";
if (command === "inventory") {
  await inventory();
} else if (command === "backup") {
  await backup();
} else if (command === "snapshot-production") {
  await snapshotProduction();
} else if (command === "apply") {
  await cloneProductionToStaging();
} else if (command === "clear-technical") {
  await clearStagingTechnicalState();
} else if (command === "clear-staging") {
  await clearAllStagingData();
} else if (command === "rotate-credentials") {
  await rotateStagingCredentials();
} else if (command === "verify-admin") {
  await verifyClonedAdmin();
} else {
  throw new Error(`Unsupported command: ${command}`);
}
