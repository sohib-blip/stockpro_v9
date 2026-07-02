import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json();

  const {
    accessory_id,
    qty,
    movement_type,
    actor,
    actor_id,
    shipment_ref,
    order_ref,
    note,
  } = body;

  const { data: accessory } = await supabase
    .from("accessories")
    .select("*")
    .eq("id", accessory_id)
    .single();

  if (!accessory) {
    return NextResponse.json(
      {
        ok: false,
        error: "Accessory not found",
      },
      { status: 404 }
    );
  }

  let newStock = accessory.current_stock;

  if (movement_type === "IN") {
    newStock += qty;
  }

  if (movement_type === "OUT") {
    newStock -= qty;
  }

  if (movement_type === "ADJUSTMENT") {
    newStock = qty;
  }

  if (newStock < 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Not enough stock",
      },
      { status: 400 }
    );
  }

  await supabase
    .from("accessories")
    .update({
      current_stock: newStock,
    })
    .eq("id", accessory_id);

  await supabase
    .from("accessory_movements")
    .insert({
      accessory_id,
      qty,
      movement_type,
      shipment_ref,
      order_ref,
      actor,
      actor_id,
      source: "manual",
      note,
    });

  return NextResponse.json({
    ok: true,
    current_stock: newStock,
  });
}