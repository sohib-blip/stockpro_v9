import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const { device, box_no, floor, imeis, actor, actor_id, shipment_ref } =
  await req.json();

    if (!device || !box_no || !Array.isArray(imeis) || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid input" },
        { status: 400 }
      );
    }

    const supabase = sb();
    const nowIso = new Date().toISOString();
    const operation_id = crypto.randomUUID();

    // 1️⃣ Create inbound batch
    const { data: batch } = await supabase
      .from("inbound_batches")
.insert({
  actor: actor || "unknown",
  vendor: "manual",
  source: "manual",
  shipment_ref: shipment_ref || null
})
      .select("batch_id")
      .single();

    if (!batch) throw new Error("Batch creation failed");

    // 2️⃣ Find or create box
    let { data: existingBox } = await supabase
      .from("boxes")
      .select("id")
      .eq("bin_id", device)
      .eq("box_code", box_no)
      .maybeSingle();

    let box_id: string;

    if (existingBox?.id) {
      box_id = existingBox.id;
    } else {
      const { data: newBox } = await supabase
        .from("boxes")
        .insert({
          bin_id: device,
          box_code: box_no,
          floor: floor || null,
        })
        .select("id")
        .single();

      if (!newBox) throw new Error("Box creation failed");
      box_id = newBox.id;
    }

    const itemsToInsert = imeis.map((imei: string) => ({
      imei,
      device_id: device, // ← on garde le bin_id
      box_id,
      status: "IN",
      imported_at: nowIso,
      imported_by: actor_id,
      import_id: batch.batch_id,
    }));

    const { data: insertedItems } = await supabase
      .from("items")
      .insert(itemsToInsert)
      .select("item_id, imei");

    if (!insertedItems) throw new Error("Item insert failed");

    // 4️⃣ Insert movements
    const movements = insertedItems.map((it: any) => ({
  type: "IN",
  operation_id,
  batch_id: batch.batch_id,
  item_id: it.item_id,
  box_id,
  device_id: device,
  imei: it.imei,
  qty: 1,
  created_by: actor_id,
  actor: actor || "unknown",
  created_at: nowIso,
}));

    await supabase.from("movements").insert(movements);

    return NextResponse.json({
      ok: true,
      inserted: insertedItems.length,
      batch_id: batch.batch_id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Manual confirm failed" },
      { status: 500 }
    );
  }
}