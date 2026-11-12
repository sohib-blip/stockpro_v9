import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiIdentity } from "@/lib/api-identity";

export const INITIAL_STOCK_REASON = "Initial stock set in Inventory Setup";
export const STOCK_COUNT_REASON = "Stock count updated in Inventory Setup";

/**
 * Sets an accessory's stock and records an ADJUSTMENT movement with the
 * stock before and after (nothing is recorded when the stock does not change).
 */
export async function saveAccessoryStockCount(
  supabase: SupabaseClient,
  input: {
    accessoryBinId: string;
    stock: number;
    identity: ApiIdentity;
    reason: string;
  }
) {
  return supabase.rpc("save_accessory_stock_count", {
    p_operation_id: randomUUID(),
    p_accessory_bin_id: input.accessoryBinId,
    p_stock: input.stock,
    p_actor_id: input.identity.userId,
    p_actor: input.identity.email,
    p_reason: input.reason,
  });
}
