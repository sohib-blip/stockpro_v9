import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages, rowsOrThrow } from "./supabase/read-all-pages";

export const SUPPLY_ITEM_COLUMNS =
  "id, supply_id, product_id, product_type, product_name, qty";

export type SupplyItem = {
  id: string;
  supply_id: string;
  product_id: string | null;
  product_type: string | null;
  product_name: string | null;
  qty: number | null;
};

export type SupplyOrder = Record<string, unknown> & {
  id: string;
  supply_items: SupplyItem[];
};

// Supply orders (newest first), each with its lines. Both tables are read page
// by page; lines are read in full and grouped here rather than filtered with a
// long `.in("supply_id", ...)` list, since every order is loaded anyway.
export async function loadSupplyOrdersWithItems(
  supabase: SupabaseClient
): Promise<SupplyOrder[]> {
  const [supplies, items] = await Promise.all([
    readAllPages((from, to) =>
      supabase
        .from("supplies")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .then(rowsOrThrow)
    ),
    readAllPages((from, to) =>
      supabase
        .from("supply_items")
        .select(SUPPLY_ITEM_COLUMNS)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
        .then(rowsOrThrow)
    ),
  ]);

  const itemsBySupply = new Map<string, SupplyItem[]>();
  for (const item of items as SupplyItem[]) {
    const key = String(item.supply_id);
    const list = itemsBySupply.get(key);
    if (list) list.push(item);
    else itemsBySupply.set(key, [item]);
  }

  return (supplies as Record<string, unknown>[]).map((supply) => ({
    ...supply,
    id: String(supply.id),
    supply_items: itemsBySupply.get(String(supply.id)) ?? [],
  }));
}
