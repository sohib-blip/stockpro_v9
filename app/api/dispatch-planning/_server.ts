import { supabaseService } from "@/lib/auth";
import {
  dispatchItemKey,
  isDispatchVolumeAccessoryCategory,
  type DispatchAutomaticAccessoryRule,
  type DispatchPickingInventoryRow,
  type PackagingOption,
} from "@/lib/dispatch-planning";

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
