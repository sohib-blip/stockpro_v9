import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "enjusebvcfjudrrnvjgl";
const previewUrl = String(process.argv[2] || "").replace(/\/$/, "");

if (!/^https:\/\/stockpro-v9-[a-z0-9-]+\.vercel\.app$/i.test(previewUrl)) {
  throw new Error("Usage: npm run test:staging -- https://stockpro-v9-...vercel.app");
}

const env = Object.fromEntries(
  (await readFile(new URL("../.env.local", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl?.includes(STAGING_PROJECT_REF)) {
  throw new Error("Refusing to run: .env.local is not StockPro-Staging");
}
if (!anonKey || !serviceRoleKey) {
  throw new Error("Missing Supabase staging credentials in .env.local");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stamp = `${Date.now()}-${randomBytes(3).toString("hex")}`;
const roleNames = ["admin", "operator", "viewer", "norole"];
const users = Object.fromEntries(
  roleNames.map((role) => [
    role,
    {
      email: `stockpro.smoke.${role}.${stamp}@example.com`,
      password: `${randomBytes(20).toString("base64url")}Aa1!`,
      id: null,
      token: null,
      client: null,
    },
  ])
);
let directBinId = null;

const allPermissions = {
  can_dashboard: true,
  can_inventory_export: true,
  can_inbound: true,
  can_outbound: true,
  can_returns: true,
  can_transfer: true,
  can_labels: true,
  can_bins: true,
  can_accessories: true,
  can_supply: true,
  can_nrd: true,
  can_admin: false,
};

const checks = [
  {
    name: "Admin users",
    path: "/api/admin/users",
    allowed: { admin: [200] },
  },
  {
    name: "Dashboard summary",
    path: "/api/dashboard/summary",
    allowed: { admin: [200], operator: [200], viewer: [200] },
  },
  {
    name: "Raw inventory export",
    path: "/api/dashboard/export",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Inventory count sheet",
    path: "/api/dashboard/export-count-sheet",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Inbound history",
    path: "/api/inbound/history?page=1",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Outbound history",
    path: "/api/outbound/history?page=1",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Returns history",
    path: "/api/returns/history?page=1",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Transfer history",
    path: "/api/transfer/history",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Accessories list",
    path: "/api/accessories/list",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Supply list",
    path: "/api/supply/list",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "NRD history",
    path: "/api/nrd/history",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Bins templates",
    path: "/api/bins/templates/list?device_id=00000000-0000-0000-0000-000000000000",
    allowed: { admin: [200], operator: [200] },
  },
  {
    name: "Labels from batch",
    path: "/api/inbound/labels/from-batch?batch_id=00000000-0000-0000-0000-000000000000",
    allowed: { admin: [404], operator: [404] },
  },
];

const results = [];

async function createUsers() {
  for (const role of roleNames) {
    const user = users[role];
    const { data, error } = await adminClient.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });
    if (error || !data.user) throw error || new Error(`Unable to create ${role}`);
    user.id = data.user.id;
  }

  const accessRoles = ["admin", "operator", "viewer"];
  const { error: roleError } = await adminClient.from("user_roles").upsert(
    accessRoles.map((role) => ({ user_id: users[role].id, role })),
    { onConflict: "user_id" }
  );
  if (roleError) throw roleError;

  const { error: permissionError } = await adminClient
    .from("user_permissions")
    .upsert(
      accessRoles.map((role) => ({
        user_id: users[role].id,
        ...allPermissions,
        can_inventory_export: role !== "viewer",
        can_inbound: role !== "viewer",
        can_outbound: role !== "viewer",
        can_returns: role !== "viewer",
        can_transfer: role !== "viewer",
        can_labels: role !== "viewer",
        can_bins: role !== "viewer",
        can_accessories: role !== "viewer",
        can_supply: role !== "viewer",
        can_nrd: role !== "viewer",
        can_admin: role === "admin",
      })),
      { onConflict: "user_id" }
    );
  if (permissionError) throw permissionError;
}

async function signInUsers() {
  for (const role of roleNames) {
    const client = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: users[role].email,
      password: users[role].password,
    });
    if (error || !data.session) throw error || new Error(`Unable to sign in ${role}`);
    users[role].token = data.session.access_token;
    users[role].client = client;
  }
}

async function request(path, token) {
  const response = await fetch(`${previewUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  await response.arrayBuffer();
  return response.status;
}

async function runChecks() {
  for (const check of checks) {
    for (const role of roleNames) {
      const status = await request(check.path, users[role].token);
      const expected = check.allowed[role] || [403];
      results.push({ check: check.name, role, status, ok: expected.includes(status) });
    }

    const status = await request(check.path, null);
    results.push({
      check: check.name,
      role: "unauthenticated",
      status,
      ok: status === 401,
    });
  }
}

function directResult(check, role, ok, detail = "") {
  results.push({
    check,
    role,
    status: detail || (ok ? "allowed" : "unexpected"),
    ok,
  });
}

async function runDirectDatabaseChecks() {
  const viewer = users.viewer.client;
  const operator = users.operator.client;

  const viewerItems = await viewer.from("items").select("imei").limit(1);
  directResult(
    "Direct items SELECT denied",
    "viewer",
    Boolean(viewerItems.error),
    viewerItems.error?.code || "no error"
  );

  const viewerMovements = await viewer.from("movements").select("id").limit(1);
  directResult(
    "Direct movements SELECT denied",
    "viewer",
    Boolean(viewerMovements.error),
    viewerMovements.error?.code || "no error"
  );

  const deniedInsert = await viewer
    .from("bins")
    .insert({ name: `SMOKE-VIEWER-${stamp}`, active: true })
    .select("id");
  directResult(
    "Viewer bin INSERT denied",
    "viewer",
    Boolean(deniedInsert.error) || deniedInsert.data?.length === 0,
    deniedInsert.error?.code || `${deniedInsert.data?.length || 0} rows`
  );

  const { data: operatorBin, error: operatorInsertError } = await operator
    .from("bins")
    .insert({ name: `SMOKE-OPERATOR-${stamp}`, active: true })
    .select("id,name")
    .single();
  directBinId = operatorBin?.id || null;
  directResult(
    "Operator bin INSERT allowed",
    "operator",
    !operatorInsertError && Boolean(directBinId),
    operatorInsertError?.code || (directBinId ? "created" : "missing row")
  );

  if (directBinId) {
    const deniedUpdate = await viewer
      .from("bins")
      .update({ name: `SMOKE-VIEWER-UPDATE-${stamp}` })
      .eq("id", directBinId)
      .select("id");
    const { data: unchangedBin } = await adminClient
      .from("bins")
      .select("name")
      .eq("id", directBinId)
      .single();
    directResult(
      "Viewer bin UPDATE denied",
      "viewer",
      (Boolean(deniedUpdate.error) || deniedUpdate.data?.length === 0) &&
        unchangedBin?.name === `SMOKE-OPERATOR-${stamp}`,
      deniedUpdate.error?.code || `${deniedUpdate.data?.length || 0} rows`
    );

    const deniedDelete = await viewer
      .from("bins")
      .delete()
      .eq("id", directBinId)
      .select("id");
    const { count: remainingBinCount } = await adminClient
      .from("bins")
      .select("id", { count: "exact", head: true })
      .eq("id", directBinId);
    directResult(
      "Viewer bin DELETE denied",
      "viewer",
      (Boolean(deniedDelete.error) || deniedDelete.data?.length === 0) &&
        remainingBinCount === 1,
      deniedDelete.error?.code || `${deniedDelete.data?.length || 0} rows`
    );

    const operatorDelete = await operator
      .from("bins")
      .delete()
      .eq("id", directBinId)
      .select("id");
    directResult(
      "Operator bin DELETE allowed",
      "operator",
      !operatorDelete.error && operatorDelete.data?.length === 1,
      operatorDelete.error?.code || `${operatorDelete.data?.length || 0} rows`
    );
    if (!operatorDelete.error && operatorDelete.data?.length === 1) {
      directBinId = null;
    }
  }

  const requestedImei = "999999999999999";
  const operatorMatch = await operator.rpc("check_existing_imeis", {
    requested_imeis: [requestedImei],
  });
  directResult(
    "Bounded IMEI match allowed",
    "operator",
    !operatorMatch.error && Array.isArray(operatorMatch.data),
    operatorMatch.error?.code || `${operatorMatch.data?.length || 0} matches`
  );

  const viewerMatch = await viewer.rpc("check_existing_imeis", {
    requested_imeis: [requestedImei],
  });
  directResult(
    "Bounded IMEI match denied",
    "viewer",
    Boolean(viewerMatch.error),
    viewerMatch.error?.code || "no error"
  );

  const oversizedMatch = await operator.rpc("check_existing_imeis", {
    requested_imeis: Array.from({ length: 201 }, (_, index) =>
      String(index).padStart(15, "9")
    ),
  });
  directResult(
    "Oversized IMEI match denied",
    "operator",
    Boolean(oversizedMatch.error),
    oversizedMatch.error?.code || "no error"
  );
}

async function cleanup() {
  if (directBinId) {
    await adminClient.from("bins").delete().eq("id", directBinId);
    directBinId = null;
  }
  const ids = roleNames.map((role) => users[role].id).filter(Boolean);
  if (ids.length) {
    await adminClient.from("user_permissions").delete().in("user_id", ids);
    await adminClient.from("user_roles").delete().in("user_id", ids);
  }
  for (const id of ids) await adminClient.auth.admin.deleteUser(id);
}

try {
  await createUsers();
  await signInUsers();
  await runChecks();
  await runDirectDatabaseChecks();

  console.table(results);
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    throw new Error(`${failures.length} staging authorization check(s) failed`);
  }
  console.log(`All ${results.length} staging authorization checks passed.`);
} finally {
  await cleanup();
}
