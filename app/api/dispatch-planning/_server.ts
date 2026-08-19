import { supabaseService } from "@/lib/auth";
import type { PackagingOption } from "@/lib/dispatch-planning";

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
