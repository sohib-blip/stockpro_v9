import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  accessoryWriteError,
  parseAccessoryBinInput,
} from "@/lib/accessory-bin-input";
import { getApiIdentity } from "@/lib/api-identity";
import {
  INITIAL_STOCK_REASON,
  saveAccessoryStockCount,
} from "@/lib/accessory-stock-count";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const input = parseAccessoryBinInput(await req.json().catch(() => null));
  if (!input.ok) {
    return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  }

  const identity = getApiIdentity(req);

  // Created at 0, then the initial stock is set with a movement (0 -> stock).
  const { data: created, error } = await supabase
    .from("accessory_bins")
    .insert({
      name: input.name,
      current_stock: 0,
      minimum_stock: input.minimumStock,
      category: input.category,
      active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    const failure = accessoryWriteError(error, input.name);
    return NextResponse.json(
      { ok: false, error: failure.error },
      { status: failure.status }
    );
  }

  if (input.currentStock > 0) {
    const { error: stockError } = await saveAccessoryStockCount(supabase, {
      accessoryBinId: created.id,
      stock: input.currentStock,
      identity,
      reason: INITIAL_STOCK_REASON,
    });

    if (stockError) {
      console.error("ACCESSORY INITIAL STOCK ERROR", stockError);
      // Nothing half-created: the new accessory is removed again.
      await supabase.from("accessory_bins").delete().eq("id", created.id);
      return NextResponse.json(
        { ok: false, error: "The accessory could not be created. Try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
