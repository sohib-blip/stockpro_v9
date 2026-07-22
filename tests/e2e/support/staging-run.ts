import { randomBytes } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { permissionsForRole, type AppRole } from "../../../lib/access-control";
import { requireStagingEnvironment } from "./environment";

type TestUser = {
  id: string;
  email: string;
  password: string;
  role: AppRole;
};

export type StagingRun = {
  stamp: string;
  users: Record<AppRole, TestUser>;
  inviteEmail: string;
  bin: { id: string; name: string };
  accessory: { id: string; name: string };
  manualImei: string;
  spreadsheetImei: string;
  manualBox: string;
  returnBox: string;
  spreadsheetBox: string;
  uiBinName: string;
};

function serviceClient() {
  const environment = requireStagingEnvironment();
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function throwOnError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`);
}

function makeImei(seed: number) {
  return `99${String(seed).padStart(13, "0").slice(-13)}`;
}

export async function createStagingRun(): Promise<StagingRun> {
  const supabase = serviceClient();
  const numericStamp = Date.now();
  const stamp = `${numericStamp}-${randomBytes(3).toString("hex")}`;
  const shortNumber = String(numericStamp).slice(-6);
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const users = {} as Record<AppRole, TestUser>;
  const run = {
    stamp,
    users,
    inviteEmail: `stockpro.e2e.invited.${stamp}@gmail.com`,
    bin: { id: "", name: `TESTDEVICE${shortNumber}` },
    accessory: { id: "", name: `E2E Accessory ${stamp}` },
    manualImei: makeImei(numericStamp),
    spreadsheetImei: makeImei(numericStamp + 1),
    manualBox: `E2E-MANUAL-${stamp}`,
    returnBox: `E2E-RETURN-${stamp}`,
    spreadsheetBox: "00001",
    uiBinName: `UITESTDEVICE${shortNumber}`,
  } satisfies StagingRun;

  try {
    for (const role of ["admin", "operator", "viewer"] as const) {
      const email = `stockpro.e2e.${role}.${stamp}@example.com`;
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      throwOnError(error, `Create ${role} user`);
      if (!data.user) throw new Error(`Create ${role} user: no user returned`);
      users[role] = { id: data.user.id, email, password, role };
    }

    const roleRows = Object.values(users).map((user) => ({
      user_id: user.id,
      role: user.role,
    }));
    const permissionRows = Object.values(users).map((user) => ({
      user_id: user.id,
      ...permissionsForRole(user.role),
    }));

    const [{ error: rolesError }, { error: permissionsError }] = await Promise.all([
      supabase.from("user_roles").upsert(roleRows, { onConflict: "user_id" }),
      supabase
        .from("user_permissions")
        .upsert(permissionRows, { onConflict: "user_id" }),
    ]);
    throwOnError(rolesError, "Assign E2E roles");
    throwOnError(permissionsError, "Assign E2E permissions");

    const { data: bin, error: binError } = await supabase
      .from("bins")
      .insert({ name: run.bin.name, active: true })
      .select("id,name")
      .single();
    throwOnError(binError, "Create E2E device bin");
    if (!bin) throw new Error("Create E2E device bin: no row returned");
    run.bin = { id: String(bin.id), name: String(bin.name) };

    const { data: accessory, error: accessoryError } = await supabase
      .from("accessory_bins")
      .insert({
        name: run.accessory.name,
        current_stock: 10,
        minimum_stock: 7,
        category: "Items",
        active: true,
      })
      .select("id,name")
      .single();
    throwOnError(accessoryError, "Create E2E accessory");
    if (!accessory) throw new Error("Create E2E accessory: no row returned");
    run.accessory = { id: String(accessory.id), name: String(accessory.name) };

    const { error: templateError } = await supabase
      .from("device_accessory_templates")
      .insert({
        device_id: run.bin.id,
        accessory_bin_id: run.accessory.id,
        quantity: 1,
        per_devices: 1,
      });
    throwOnError(templateError, "Create E2E automatic accessory rule");

    return run;
  } catch (error) {
    await cleanupStagingRun(run, supabase);
    throw error;
  }
}

async function deleteSuppliesForUsers(supabase: SupabaseClient, userIds: string[]) {
  if (!userIds.length) return;
  const { data } = await supabase
    .from("supplies")
    .select("id")
    .in("created_by_id", userIds);
  const ids = (data || []).map((row) => row.id);
  if (!ids.length) return;

  await supabase.from("supply_status_history").delete().in("supply_id", ids);
  await supabase.from("supply_items").delete().in("supply_id", ids);
  await supabase.from("supplies").delete().in("id", ids);
}

export async function cleanupStagingRun(
  run: StagingRun,
  existingClient?: SupabaseClient
) {
  const supabase = existingClient || serviceClient();
  const userIds = Object.values(run.users)
    .map((user) => user?.id)
    .filter(Boolean);
  const userEmails = [
    ...Object.values(run.users)
    .map((user) => user?.email)
    .filter(Boolean),
    run.inviteEmail,
  ];

  const { data: authUsers } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  for (const user of authUsers?.users || []) {
    if (user.email && userEmails.includes(user.email) && !userIds.includes(user.id)) {
      userIds.push(user.id);
    }
  }
  const imeis = [run.manualImei, run.spreadsheetImei];

  const { data: items } = await supabase
    .from("items")
    .select("item_id,box_id,import_id")
    .in("imei", imeis);
  const itemIds = (items || []).map((row) => row.item_id).filter(Boolean);
  const boxIds = (items || []).map((row) => row.box_id).filter(Boolean);
  const batchIds = (items || []).map((row) => row.import_id).filter(Boolean);

  if (itemIds.length) await supabase.from("movements").delete().in("item_id", itemIds);
  if (boxIds.length) await supabase.from("movements").delete().in("box_id", boxIds);
  await supabase.from("movements").delete().in("imei", imeis);
  if (run.bin.id) {
    await supabase.from("movements").delete().eq("device_id", run.bin.id);
  }
  await supabase.from("items").delete().in("imei", imeis);
  if (run.bin.id) {
    await supabase
      .from("boxes")
      .delete()
      .eq("bin_id", run.bin.id)
      .in("box_code", [run.manualBox, run.returnBox, run.spreadsheetBox]);
  }
  if (batchIds.length) {
    await supabase.from("inbound_batches").delete().in("batch_id", batchIds);
  }
  if (userEmails.length) {
    await supabase.from("inbound_batches").delete().in("actor", userEmails);
  }

  if (run.accessory.id) {
    await supabase
      .from("device_accessory_templates")
      .delete()
      .eq("accessory_bin_id", run.accessory.id);
    await supabase
      .from("accessory_movements")
      .delete()
      .eq("accessory_bin_id", run.accessory.id);
    await supabase.from("accessory_bins").delete().eq("id", run.accessory.id);
  }

  if (userIds.length) {
    await deleteSuppliesForUsers(supabase, userIds);
    await supabase.from("nrd_time_logs").delete().in("user_id", userIds);
  }
  if (userEmails.length) {
    await supabase.from("nrd_time_logs").delete().in("user_email", userEmails);
  }

  await supabase.from("bins").delete().eq("name", run.uiBinName);
  if (run.bin.id) {
    await supabase
      .from("device_accessory_templates")
      .delete()
      .eq("device_id", run.bin.id);
    await supabase.from("bins").delete().eq("id", run.bin.id);
  }

  if (userIds.length) {
    await supabase.from("profiles").delete().in("user_id", userIds);
    await supabase.from("user_permissions").delete().in("user_id", userIds);
    await supabase.from("user_roles").delete().in("user_id", userIds);
  }
  for (const userId of userIds) {
    await supabase.auth.admin.deleteUser(userId);
  }
}

export async function assertStagingRunClean(run: StagingRun) {
  const supabase = serviceClient();
  const userIds = Object.values(run.users).map((user) => user.id);
  const userEmails = [
    ...Object.values(run.users).map((user) => user.email),
    run.inviteEmail,
  ];

  async function rowCount(
    operation: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    label: string
  ) {
    const { count, error } = await operation;
    throwOnError(error, `Verify cleanup for ${label}`);
    return Number(count || 0);
  }

  const checks = await Promise.all([
    rowCount(
      supabase.from("items").select("*", { count: "exact", head: true }).in("imei", [run.manualImei, run.spreadsheetImei]),
      "items"
    ),
    rowCount(
      supabase.from("boxes").select("*", { count: "exact", head: true }).eq("bin_id", run.bin.id).in("box_code", [run.manualBox, run.returnBox, run.spreadsheetBox]),
      "boxes"
    ),
    rowCount(
      supabase.from("movements").select("*", { count: "exact", head: true }).in("imei", [run.manualImei, run.spreadsheetImei]),
      "device movements"
    ),
    rowCount(
      supabase.from("inbound_batches").select("*", { count: "exact", head: true }).in("actor", userEmails),
      "inbound batches"
    ),
    rowCount(
      supabase.from("accessory_bins").select("*", { count: "exact", head: true }).eq("id", run.accessory.id),
      "accessory"
    ),
    rowCount(
      supabase.from("accessory_movements").select("*", { count: "exact", head: true }).eq("accessory_bin_id", run.accessory.id),
      "accessory movements"
    ),
    rowCount(
      supabase.from("device_accessory_templates").select("*", { count: "exact", head: true }).eq("device_id", run.bin.id),
      "automatic accessory rules"
    ),
    rowCount(
      supabase.from("bins").select("*", { count: "exact", head: true }).in("name", [run.bin.name, run.uiBinName]),
      "bins"
    ),
    rowCount(
      supabase.from("supplies").select("*", { count: "exact", head: true }).in("created_by_id", userIds),
      "supply orders"
    ),
    rowCount(
      supabase.from("nrd_time_logs").select("*", { count: "exact", head: true }).in("user_email", userEmails),
      "NRD logs"
    ),
    rowCount(
      supabase.from("profiles").select("*", { count: "exact", head: true }).in("user_id", userIds),
      "profiles"
    ),
    rowCount(
      supabase.from("user_permissions").select("*", { count: "exact", head: true }).in("user_id", userIds),
      "user permissions"
    ),
    rowCount(
      supabase.from("user_roles").select("*", { count: "exact", head: true }).in("user_id", userIds),
      "user roles"
    ),
  ]);

  const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  throwOnError(authError, "Verify cleanup for auth users");
  const remainingAuthUsers = (authUsers?.users || []).filter(
    (user) => user.email && userEmails.includes(user.email)
  );

  const remainingRows = checks.reduce((sum, count) => sum + count, 0);
  if (remainingRows > 0 || remainingAuthUsers.length > 0) {
    throw new Error(
      `E2E cleanup incomplete: ${remainingRows} database rows and ${remainingAuthUsers.length} auth users remain`
    );
  }
}

export async function accessTokenFor(user: TestUser) {
  const environment = requireStagingEnvironment();
  const client = createClient(environment.supabaseUrl, environment.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  throwOnError(error, `Sign in ${user.role} test user`);
  if (!data.session) throw new Error(`Sign in ${user.role}: no session returned`);
  return data.session.access_token;
}

export async function readItem(imei: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("items")
    .select("imei,status,box_id,boxes(box_code,floor)")
    .eq("imei", imei)
    .maybeSingle();
  throwOnError(error, `Read E2E item ${imei}`);
  return data as
    | { imei: string; status: string; box_id: string; boxes: { box_code: string; floor: string } | null }
    | null;
}

export async function readAccessoryStock(id: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("accessory_bins")
    .select("current_stock")
    .eq("id", id)
    .single();
  throwOnError(error, `Read E2E accessory ${id}`);
  return Number(data?.current_stock || 0);
}

export async function countInboundBatchesByReference(shipmentRef: string) {
  const supabase = serviceClient();
  const { count, error } = await supabase
    .from("inbound_batches")
    .select("*", { count: "exact", head: true })
    .eq("shipment_ref", shipmentRef);
  throwOnError(error, `Count inbound batches for ${shipmentRef}`);
  return Number(count || 0);
}
