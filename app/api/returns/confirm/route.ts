import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const {
      items,
      target_box,
      target_floor,
      return_ref,
      return_type,
      return_reason,
      actor,
      actor_id,
    } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ ok: false, error: "No items to return" }, { status: 400 });
    }

    if (!target_box) {
      return NextResponse.json({ ok: false, error: "Target box required" }, { status: 400 });
    }

    if (!return_type) {
      return NextResponse.json({ ok: false, error: "Return type required" }, { status: 400 });
    }

    if (!return_reason) {
      return NextResponse.json({ ok: false, error: "Return reason required" }, { status: 400 });
    }

    if (!actor_id) {
      return NextResponse.json({ ok: false, error: "actor_id required" }, { status: 400 });
    }

    const operation_id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    let returned = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    for (const item of items) {
      const device_id = item.device_id;
      const imei = item.imei;
      const item_id = item.item_id;

      const { data: current, error: currentErr } = await supabase
        .from("items")
        .select("item_id, status, device_id")
        .eq("item_id", item_id)
        .single();

      if (currentErr) throw currentErr;

      if (!current || String(current.status).toUpperCase() !== "OUT") {
        continue;
      }

      const { data: existingBox, error: boxFindErr } = await supabase
        .from("boxes")
        .select("id, floor")
        .eq("bin_id", device_id)
        .eq("box_code", target_box)
        .maybeSingle();

      if (boxFindErr) throw boxFindErr;

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes++;

        if (target_floor && existingBox.floor !== target_floor) {
          const { error: floorErr } = await supabase
            .from("boxes")
            .update({ floor: target_floor })
            .eq("id", box_id);

          if (floorErr) throw floorErr;
        }
      } else {
        const { data: newBox, error: newBoxErr } = await supabase
          .from("boxes")
          .insert({
            bin_id: device_id,
            box_code: target_box,
            floor: target_floor || null,
          })
          .select("id")
          .single();

        if (newBoxErr) throw newBoxErr;

        box_id = String(newBox.id);
        createdBoxes++;
      }

      const { error: updateErr } = await supabase
        .from("items")
        .update({
          status: "IN",
          box_id,
        })
        .eq("item_id", item_id)
        .eq("status", "OUT");

      if (updateErr) throw updateErr;

      const { error: movementErr } = await supabase.from("movements").insert({
        type: "RETURN",
        operation_id,
        item_id,
        box_id,
        device_id,
        imei,
        qty: 1,
        actor: actor || "unknown",
        created_by: actor_id,
        created_at: nowIso,
        shipment_ref: return_ref || null,
        source: "customer_return",
        return_type,
        return_reason,
        notes: `${return_type} - ${return_reason}`,
      });

      if (movementErr) throw movementErr;

      returned++;
    }

    return NextResponse.json({
      ok: true,
      operation_id,
      returned,
      created_boxes: createdBoxes,
      reused_boxes: reusedBoxes,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Return confirm failed" },
      { status: 500 }
    );
  }
}