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
  alternateBin: { id: string; name: string };
  accessory: { id: string; name: string };
  dispatchRuleDevice: { id: string; name: string; owned: boolean };
  dispatchRuleAccessory: { id: string; name: string };
  packaging: { id: string; code: string; name: string };
  dispatchPackaging: { id: string; code: string; name: string };
  dispatchAlternatePackaging: { id: string; code: string; name: string };
  manualImei: string;
  spreadsheetImei: string;
  manualBox: string;
  emptyBox: string;
  returnBox: string;
  securityReturnBox: string;
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
  const run: StagingRun = {
    stamp,
    users,
    inviteEmail: `stockpro.e2e.invited.${stamp}@gmail.com`,
    bin: { id: "", name: `TESTDEVICE${shortNumber}` },
    alternateBin: { id: "", name: `TESTALTERNATE${shortNumber}` },
    accessory: { id: "", name: `E2E Cable ${stamp}` },
    dispatchRuleDevice: { id: "", name: "FMC880", owned: false },
    dispatchRuleAccessory: { id: "", name: "FOB" },
    packaging: {
      id: "",
      code: `E2E-PKG-${shortNumber}`,
      name: `E2E Packaging ${stamp}`,
    },
    dispatchPackaging: {
      id: "",
      code: `E2E-DSP-${shortNumber}`,
      name: `E2E Dispatch Box ${stamp}`,
    },
    dispatchAlternatePackaging: {
      id: "",
      code: `E2E-DSP-ALT-${shortNumber}`,
      name: `E2E Dispatch Alternate ${stamp}`,
    },
    manualImei: makeImei(numericStamp),
    spreadsheetImei: makeImei(numericStamp + 1),
    manualBox: `E2E-MANUAL-${stamp}`,
    emptyBox: `E2E-EMPTY-${stamp}`,
    returnBox: `E2E-RETURN-${stamp}`,
    securityReturnBox: `E2E-SECURITY-RETURN-${stamp}`,
    spreadsheetBox: "00001",
    uiBinName: `UITESTDEVICE${shortNumber}`,
  };

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

    const { data: alternateBin, error: alternateBinError } = await supabase
      .from("bins")
      .insert({ name: run.alternateBin.name, active: true })
      .select("id,name")
      .single();
    throwOnError(alternateBinError, "Create alternate E2E device bin");
    if (!alternateBin) {
      throw new Error("Create alternate E2E device bin: no row returned");
    }
    run.alternateBin = {
      id: String(alternateBin.id),
      name: String(alternateBin.name),
    };

    const { error: emptyBoxError } = await supabase.from("boxes").insert({
      bin_id: run.bin.id,
      box_code: run.emptyBox,
      floor: "00",
    });
    throwOnError(emptyBoxError, "Create E2E empty transfer box");

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

    const { data: existingDispatchDevices, error: existingDispatchDeviceError } =
      await supabase
        .from("bins")
        .select("id,name")
        .eq("name", run.dispatchRuleDevice.name)
        .eq("active", true)
        .limit(1);
    throwOnError(
      existingDispatchDeviceError,
      "Read E2E dispatch rule device"
    );
    const existingDispatchDevice = existingDispatchDevices?.[0];
    if (existingDispatchDevice) {
      run.dispatchRuleDevice = {
        id: String(existingDispatchDevice.id),
        name: String(existingDispatchDevice.name),
        owned: false,
      };
    } else {
      const { data: dispatchRuleDevice, error: dispatchRuleDeviceError } =
        await supabase
          .from("bins")
          .insert({ name: run.dispatchRuleDevice.name, active: true })
          .select("id,name")
          .single();
      throwOnError(dispatchRuleDeviceError, "Create E2E dispatch rule device");
      if (!dispatchRuleDevice) {
        throw new Error("Create E2E dispatch rule device: no row returned");
      }
      run.dispatchRuleDevice = {
        id: String(dispatchRuleDevice.id),
        name: String(dispatchRuleDevice.name),
        owned: true,
      };
    }

    const { data: dispatchRuleAccessory, error: dispatchRuleAccessoryError } =
      await supabase
        .from("accessory_bins")
        .insert({
          name: run.dispatchRuleAccessory.name,
          current_stock: 10,
          minimum_stock: 0,
          category: "Items",
          active: true,
        })
        .select("id,name")
        .single();
    throwOnError(
      dispatchRuleAccessoryError,
      "Create E2E dispatch rule accessory"
    );
    if (!dispatchRuleAccessory) {
      throw new Error("Create E2E dispatch rule accessory: no row returned");
    }
    run.dispatchRuleAccessory = {
      id: String(dispatchRuleAccessory.id),
      name: String(dispatchRuleAccessory.name),
    };

    const { error: dispatchRuleError } = await supabase
      .from("device_accessory_templates")
      .insert({
        device_id: run.dispatchRuleDevice.id,
        accessory_bin_id: run.dispatchRuleAccessory.id,
        quantity: 1,
        per_devices: 1,
      });
    throwOnError(dispatchRuleError, "Create E2E dispatch automatic rule");

    const { data: dispatchPackaging, error: dispatchPackagingError } = await supabase
      .from("packaging_types")
      .insert({
        code: run.dispatchPackaging.code,
        name: run.dispatchPackaging.name,
        category: "BOX",
        length_cm: 10,
        width_cm: 9,
        height_cm: 2,
        on_hand_stock: 5,
        reserved_stock: 0,
        minimum_stock: 0,
        active: true,
        sort_order: 1,
        source_name: "StockPro E2E dispatch planning",
      })
      .select("id,code,name")
      .single();
    throwOnError(dispatchPackagingError, "Create E2E dispatch packaging");
    if (!dispatchPackaging) {
      throw new Error("Create E2E dispatch packaging: no row returned");
    }
    run.dispatchPackaging = {
      id: String(dispatchPackaging.id),
      code: String(dispatchPackaging.code),
      name: String(dispatchPackaging.name),
    };

    const {
      data: dispatchAlternatePackaging,
      error: dispatchAlternatePackagingError,
    } = await supabase
      .from("packaging_types")
      .insert({
        code: run.dispatchAlternatePackaging.code,
        name: run.dispatchAlternatePackaging.name,
        category: "BOX",
        length_cm: 12,
        width_cm: 10,
        height_cm: 3,
        on_hand_stock: 5,
        reserved_stock: 0,
        minimum_stock: 0,
        active: true,
        sort_order: 2,
        source_name: "StockPro E2E adaptive dispatch planning",
      })
      .select("id,code,name")
      .single();
    throwOnError(
      dispatchAlternatePackagingError,
      "Create alternate E2E dispatch packaging"
    );
    if (!dispatchAlternatePackaging) {
      throw new Error(
        "Create alternate E2E dispatch packaging: no row returned"
      );
    }
    run.dispatchAlternatePackaging = {
      id: String(dispatchAlternatePackaging.id),
      code: String(dispatchAlternatePackaging.code),
      name: String(dispatchAlternatePackaging.name),
    };

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

  if (userIds.length) {
    const { data: exportBatches } = await supabase
      .from("return_template_export_batches")
      .select("id,actor_id")
      .in("actor_id", userIds);
    for (const batch of exportBatches || []) {
      await supabase.rpc("release_return_template_export_batch", {
        p_batch_id: batch.id,
        p_actor_id: batch.actor_id,
      });
    }
  }

  if (itemIds.length) {
    await supabase.from("return_records").delete().in("item_id", itemIds);
  }
  await supabase.from("return_records").delete().in("imei", imeis);
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
      .in("box_code", [
        run.manualBox,
        run.emptyBox,
        run.returnBox,
        run.securityReturnBox,
        run.spreadsheetBox,
      ]);
  }
  if (batchIds.length) {
    await supabase.from("inbound_batches").delete().in("batch_id", batchIds);
  }
  if (userEmails.length) {
    await supabase.from("inbound_batches").delete().in("actor", userEmails);
  }

  if (userIds.length) {
    await supabase.from("dispatch_batches").delete().in("actor_id", userIds);
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
  if (run.dispatchRuleAccessory.id) {
    await supabase
      .from("device_accessory_templates")
      .delete()
      .eq("accessory_bin_id", run.dispatchRuleAccessory.id);
    await supabase
      .from("accessory_movements")
      .delete()
      .eq("accessory_bin_id", run.dispatchRuleAccessory.id);
    await supabase
      .from("accessory_bins")
      .delete()
      .eq("id", run.dispatchRuleAccessory.id);
  }

  const { data: packagingTypes } = await supabase
    .from("packaging_types")
    .select("id")
    .in("code", [
      run.packaging.code,
      run.dispatchPackaging.code,
      run.dispatchAlternatePackaging.code,
    ]);
  const packagingTypeIds = (packagingTypes || []).map((row) => row.id);
  if (packagingTypeIds.length) {
    await supabase
      .from("packaging_stock_movements")
      .delete()
      .in("packaging_type_id", packagingTypeIds);
    await supabase.from("packaging_types").delete().in("id", packagingTypeIds);
  }

  if (userIds.length) {
    await deleteSuppliesForUsers(supabase, userIds);
    await supabase.from("nrd_time_logs").delete().in("user_id", userIds);
  }
  if (userEmails.length) {
    await supabase.from("nrd_time_logs").delete().in("user_email", userEmails);
    await supabase.from("connection_events").delete().in("email", userEmails);
  }

  await supabase.from("bins").delete().eq("name", run.uiBinName);
  if (run.bin.id) {
    await supabase
      .from("device_accessory_templates")
      .delete()
      .eq("device_id", run.bin.id);
    await supabase.from("bins").delete().eq("id", run.bin.id);
  }
  if (run.alternateBin.id) {
    await supabase.from("bins").delete().eq("id", run.alternateBin.id);
  }
  if (run.dispatchRuleDevice.id && run.dispatchRuleDevice.owned) {
    await supabase.from("bins").delete().eq("id", run.dispatchRuleDevice.id);
  }

  if (userIds.length) {
    await supabase
      .from("inventory_command_receipts")
      .delete()
      .in("actor_id", userIds);
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
      supabase
        .from("boxes")
        .select("*", { count: "exact", head: true })
        .eq("bin_id", run.bin.id)
        .in("box_code", [
          run.manualBox,
          run.emptyBox,
          run.returnBox,
          run.securityReturnBox,
          run.spreadsheetBox,
        ]),
      "boxes"
    ),
    rowCount(
      supabase.from("movements").select("*", { count: "exact", head: true }).in("imei", [run.manualImei, run.spreadsheetImei]),
      "device movements"
    ),
    rowCount(
      supabase.from("return_records").select("*", { count: "exact", head: true }).in("imei", [run.manualImei, run.spreadsheetImei]),
      "return records"
    ),
    rowCount(
      supabase.from("return_template_export_batches").select("*", { count: "exact", head: true }).in("actor_id", userIds),
      "return template export batches"
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
      supabase.from("accessory_bins").select("*", { count: "exact", head: true }).eq("id", run.dispatchRuleAccessory.id),
      "dispatch rule accessory"
    ),
    rowCount(
      supabase.from("device_accessory_templates").select("*", { count: "exact", head: true }).eq("accessory_bin_id", run.dispatchRuleAccessory.id),
      "dispatch automatic accessory rule"
    ),
    rowCount(
      supabase.from("device_accessory_templates").select("*", { count: "exact", head: true }).eq("device_id", run.bin.id),
      "automatic accessory rules"
    ),
    rowCount(
      supabase.from("packaging_types").select("*", { count: "exact", head: true }).eq("code", run.packaging.code),
      "packaging types"
    ),
    rowCount(
      supabase.from("packaging_types").select("*", { count: "exact", head: true }).eq("code", run.dispatchPackaging.code),
      "dispatch packaging type"
    ),
    rowCount(
      supabase.from("packaging_types").select("*", { count: "exact", head: true }).eq("code", run.dispatchAlternatePackaging.code),
      "alternate dispatch packaging type"
    ),
    rowCount(
      supabase.from("dispatch_batches").select("*", { count: "exact", head: true }).in("actor_id", userIds),
      "dispatch batches"
    ),
    rowCount(
      supabase.from("packaging_stock_movements").select("*", { count: "exact", head: true }).in("actor_id", userIds),
      "packaging stock movements"
    ),
    rowCount(
      supabase
        .from("bins")
        .select("*", { count: "exact", head: true })
        .in("name", [run.bin.name, run.alternateBin.name, run.uiBinName]),
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
      supabase.from("connection_events").select("*", { count: "exact", head: true }).in("email", userEmails),
      "connection events"
    ),
    rowCount(
      supabase.from("inventory_command_receipts").select("*", { count: "exact", head: true }).in("actor_id", userIds),
      "inventory command receipts"
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
  const response = await fetch(`${environment.baseURL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.session?.access_token) {
    throw new Error(
      `Sign in ${user.role} test user: ${body?.error || response.status}`
    );
  }

  const accessToken = String(body.session.access_token);
  if (body.requires_takeover) {
    const takeover = await fetch(
      `${environment.baseURL}/api/auth/connection-event`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_id: body.event_id }),
      }
    );
    if (!takeover.ok) {
      throw new Error(
        `Take over ${user.role} test session: ${takeover.status}`
      );
    }
  }

  return accessToken;
}

export async function readItem(imei: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("items")
    .select("item_id,imei,device_id,status,box_id,boxes(bin_id,box_code,floor)")
    .eq("imei", imei)
    .maybeSingle();
  throwOnError(error, `Read E2E item ${imei}`);
  return data as
    | {
        item_id: string;
        imei: string;
        device_id: string;
        status: string;
        box_id: string;
        boxes: { bin_id: string; box_code: string; floor: string } | null;
      }
    | null;
}

export async function readReturnMovement(operationId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("movements")
    .select("item_id,imei,device_id,box_id")
    .eq("operation_id", operationId)
    .eq("type", "RETURN")
    .single();
  throwOnError(error, "Read E2E return movement");
  return data as {
    item_id: string;
    imei: string;
    device_id: string;
    box_id: string;
  };
}

export async function readReturnRecord(operationId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("return_records")
    .select(
      "operation_id,item_id,imei,device_id,reported_device,return_ref,customer,sur_id,courier,country_code,return_status,target_box,target_floor,stock_action"
    )
    .eq("operation_id", operationId)
    .single();
  throwOnError(error, "Read E2E return record");
  return data as {
    operation_id: string;
    item_id: string;
    imei: string;
    device_id: string;
    reported_device: string;
    return_ref: string;
    customer: string;
    sur_id: string;
    courier: string;
    country_code: string;
    return_status: string;
    target_box: string | null;
    target_floor: string | null;
    stock_action: string;
  };
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

export async function readPackagingStock(id: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("packaging_types")
    .select("on_hand_stock")
    .eq("id", id)
    .single();
  throwOnError(error, `Read E2E packaging ${id}`);
  return Number(data?.on_hand_stock || 0);
}

export async function countAccessoryMovements(operationIds: string[]) {
  const supabase = serviceClient();
  const { count, error } = await supabase
    .from("accessory_movements")
    .select("*", { count: "exact", head: true })
    .in("operation_id", operationIds);
  throwOnError(error, "Count E2E accessory movements");
  return Number(count || 0);
}

export async function readSupplyForProduct(productName: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("supply_items")
    .select("supply_id,supplies(id,status)")
    .eq("product_name", productName)
    .single();
  throwOnError(error, `Read E2E supply for ${productName}`);
  const supply = Array.isArray(data?.supplies)
    ? data.supplies[0]
    : data?.supplies;
  return supply
    ? { id: String(supply.id), status: String(supply.status) }
    : null;
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
