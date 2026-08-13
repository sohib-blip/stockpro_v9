import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildAccessoryHistoryRows,
  type AccessoryHistoryBin,
  type AccessoryMovementHistoryRow,
} from "@/lib/accessory-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: movements, error: movementError } = await supabase
      .from("accessory_movements")
      .select("*")
      .eq("movement_type", "OUT")
      .order("created_at", { ascending: false })
      .limit(50);

    if (movementError) throw movementError;

    const typedMovements = (movements || []).map((movement: any) => ({
      id: movement.id,
      created_at: movement.created_at,
      shipment_ref: movement.shipment_ref || null,
      note: movement.note || null,
      qty: Number(movement.qty || 0),
      actor: movement.actor || movement.performed_by || null,
      source: movement.source || null,
      movement_type: movement.movement_type,
      accessory_bin_id: movement.accessory_bin_id || null,
    })) as AccessoryMovementHistoryRow[];
    const accessoryIds = Array.from(
      new Set(
        typedMovements
          .map((movement) => movement.accessory_bin_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let accessoryBins: AccessoryHistoryBin[] = [];

    if (accessoryIds.length > 0) {
      const { data, error } = await supabase
        .from("accessory_bins")
        .select("id,name")
        .in("id", accessoryIds);

      if (error) throw error;
      accessoryBins = (data || []) as AccessoryHistoryBin[];
    }

    const rows = buildAccessoryHistoryRows(typedMovements, accessoryBins);

    return NextResponse.json(
      { ok: true, rows },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
