import { supabaseService } from "@/lib/auth";
import {
  createInventoryDispatchCatalog,
  DEFAULT_DISPATCH_CATALOG,
  dispatchItemKey,
  isDispatchVolumeAccessoryCategory,
  type DispatchAutomaticAccessoryRule,
  type DispatchCatalog,
  type DispatchInventoryRecord,
  type DispatchPickingInventoryRow,
  type PackagingOption,
} from "@/lib/dispatch-planning";

export type DispatchInventoryItem = DispatchInventoryRecord & {
  kind: "device" | "accessory";
  id: string;
  active: boolean;
  category: string | null;
};

// The dimension columns arrive with migration 20261019150000. Until it is
// applied, dispatch keeps using the dimensions built into the application.
export function isMissingDispatchColumns(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null;
  return (
    value?.code === "42703" ||
    /length_cm|width_cm|height_cm|kinesis_names/.test(String(value?.message || ""))
  );
}

function optionalNumber(value: unknown) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function toInventoryItem(
  kind: "device" | "accessory",
  row: Record<string, unknown>
): DispatchInventoryItem {
  return {
    kind,
    id: String(row.id),
    name: String(row.name ?? ""),
    active: row.active !== false,
    category: row.category === undefined || row.category === null ? null : String(row.category),
    lengthCm: optionalNumber(row.length_cm),
    widthCm: optionalNumber(row.width_cm),
    heightCm: optionalNumber(row.height_cm),
    kinesisNames: Array.isArray(row.kinesis_names) ? row.kinesis_names.map(String) : [],
  };
}

// Device Bins and Accessory Inventory records (hidden ones included), with
// their dispatch dimensions. Packaging is managed in Packaging Inventory.
export async function loadDispatchInventoryItems(): Promise<{
  available: boolean;
  items: DispatchInventoryItem[];
}> {
  const service = supabaseService();
  const [{ data: bins, error: binsError }, { data: accessories, error: accessoriesError }] =
    await Promise.all([
      service
        .from("bins")
        .select("id,name,active,length_cm,width_cm,height_cm,kinesis_names")
        .order("name", { ascending: true }),
      service
        .from("accessory_bins")
        .select("id,name,category,active,length_cm,width_cm,height_cm,kinesis_names")
        .or("category.is.null,category.neq.Packages")
        .order("name", { ascending: true }),
    ]);

  const error = binsError || accessoriesError;
  if (error) {
    if (isMissingDispatchColumns(error)) return { available: false, items: [] };
    throw error;
  }

  return {
    available: true,
    items: [
      ...(bins || []).map((row) => toInventoryItem("device", row)),
      ...(accessories || []).map((row) => toInventoryItem("accessory", row)),
    ],
  };
}

export async function loadDispatchCatalog(): Promise<DispatchCatalog> {
  const inventory = await loadDispatchInventoryItems();
  if (!inventory.available) {
    console.warn("DISPATCH DIMENSION COLUMNS MISSING: using built-in dimensions");
    return DEFAULT_DISPATCH_CATALOG;
  }
  return createInventoryDispatchCatalog(
    inventory.items.filter((item) => item.kind === "device"),
    inventory.items.filter((item) => item.kind === "accessory")
  );
}

export async function loadDispatchPackagingOptions(): Promise<PackagingOption[]> {
  const { data, error } = await supabaseService()
    .from("packaging_types")
    .select(
      "id,code,name,category,length_cm,width_cm,height_cm,on_hand_stock,reserved_stock,active"
    )
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    category: String(row.category),
    lengthCm: Number(row.length_cm),
    widthCm: Number(row.width_cm),
    heightCm: Number(row.height_cm),
    onHandStock: Number(row.on_hand_stock || 0),
    reservedStock: Number(row.reserved_stock || 0),
    active: row.active === true,
  }));
}

export async function loadDispatchAutomaticAccessoryRules(
  deviceModels: string[]
): Promise<DispatchAutomaticAccessoryRule[]> {
  const requestedModels = new Map(
    deviceModels.map((model) => [dispatchItemKey(model), model])
  );
  if (requestedModels.size === 0) return [];

  const service = supabaseService();
  const { data: bins, error: binsError } = await service
    .from("bins")
    .select("id,name")
    .eq("active", true);
  if (binsError) throw binsError;

  const matchingBins = (bins || []).filter((bin) =>
    requestedModels.has(dispatchItemKey(bin.name))
  );
  if (matchingBins.length === 0) return [];

  const binIds = matchingBins.map((bin) => String(bin.id));
  const { data: templates, error: templatesError } = await service
    .from("device_accessory_templates")
    .select("device_id,accessory_bin_id,quantity,per_devices")
    .in("device_id", binIds);
  if (templatesError) throw templatesError;
  if (!templates?.length) return [];

  const accessoryIds = Array.from(
    new Set(templates.map((template) => String(template.accessory_bin_id)))
  );
  const { data: accessories, error: accessoriesError } = await service
    .from("accessory_bins")
    .select("id,name,category")
    .eq("active", true)
    .in("id", accessoryIds);
  if (accessoriesError) throw accessoriesError;

  const deviceNameById = new Map(
    matchingBins.map((bin) => [String(bin.id), String(bin.name)])
  );
  const accessoryNameById = new Map(
    (accessories || [])
      .filter((accessory) =>
        isDispatchVolumeAccessoryCategory(accessory.category)
      )
      .map((accessory) => [
        String(accessory.id),
        String(accessory.name),
      ])
  );

  return templates.flatMap((template) => {
    const deviceModel = deviceNameById.get(String(template.device_id));
    const accessoryName = accessoryNameById.get(
      String(template.accessory_bin_id)
    );
    return deviceModel && accessoryName
      ? [
          {
            deviceModel,
            accessoryName,
            quantity: Number(template.quantity),
            perDevices: Number(template.per_devices),
          },
        ]
      : [];
  });
}

// Devices in stock on the Cabinet floor, where orders are picked from first.
export async function loadDispatchCabinetStock(): Promise<Record<string, number>> {
  const { data, error } = await supabaseService()
    .from("dashboard_floors_view")
    .select("device,imei_count")
    .eq("floor", "Cabinet");
  if (error) throw error;

  const stock: Record<string, number> = {};
  for (const row of data || []) {
    const device = String(row.device ?? "");
    if (!device) continue;
    stock[device] = (stock[device] || 0) + Number(row.imei_count || 0);
  }
  return stock;
}

export async function loadDispatchPickingInventory(): Promise<{
  devices: DispatchPickingInventoryRow[];
  accessories: DispatchPickingInventoryRow[];
}> {
  const service = supabaseService();
  const [
    { data: bins, error: binsError },
    { data: deviceStock, error: deviceStockError },
    { data: accessories, error: accessoriesError },
  ] = await Promise.all([
    service.from("bins").select("id,name").eq("active", true),
    service.from("dashboard_bins_view").select("device_id,imei_count"),
    service
      .from("accessory_bins")
      .select("name,current_stock")
      .eq("active", true)
      .or("category.is.null,category.neq.Packages"),
  ]);
  const error = binsError || deviceStockError || accessoriesError;
  if (error) throw error;

  const deviceStockById = new Map(
    (deviceStock || []).map((row) => [
      String(row.device_id),
      Number(row.imei_count || 0),
    ])
  );
  return {
    devices: (bins || []).map((bin) => ({
      name: String(bin.name),
      availableStock: deviceStockById.get(String(bin.id)) || 0,
    })),
    accessories: (accessories || []).map((accessory) => ({
      name: String(accessory.name),
      availableStock: Number(accessory.current_stock || 0),
    })),
  };
}
