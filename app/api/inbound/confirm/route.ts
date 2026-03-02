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

type LabelPayload = {
  device_id: string;   // bin_id
  box_no: string;      // box_code
  floor?: string;
  imeis: string[];
};

export async function POST(req: Request) {
  try {
    const { labels, actor, actor_id, vendor } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    if (!actor_id) {
      return NextResponse.json(
        { ok: false, error: "actor_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();
    const nowIso = new Date().toISOString();

    // 🔹 CREATE INBOUND BATCH
    const { data: batch, error: batchErr } = await supabase
      .from("inbound_batches")
      .insert({
        actor: actor || "unknown",
        vendor: vendor || "unknown",
        source: "excel",
      })
      .select("batch_id, created_at")
      .single();

    if (batchErr) throw batchErr;

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    // 🔹 LOAD EXISTING IMEIS TO AVOID DUPLICATES
    const { data: existingItems } = await supabase
      .from("items")
      .select("imei");

    const existingSet = new Set(
      (existingItems || []).map((x: any) => String(x.imei))
    );

    // 🔹 PROCESS EACH LABEL GROUP
    for (const raw of labels as LabelPayload[]) {
      const bin_id = String(raw.device_id || "").trim();
      const box_code = String(raw.box_no || "").trim();
      const floor = String(raw.floor || "").trim();

      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (!bin_id || !box_code || imeis.length === 0) continue;

      // 🔹 FIND OR CREATE BOX
      const { data: existingBox } = await supabase
        .from("boxes")
        .select("id, floor")
        .eq("bin_id", bin_id)
        .eq("box_code", box_code)
        .maybeSingle();

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes++;

        if (floor && existingBox.floor !== floor) {
          await supabase
            .from("boxes")
            .update({ floor })
            .eq("id", box_id);
        }

      } else {
        const { data: newBox, error: newBoxErr } = await supabase
          .from("boxes")
          .insert({
            bin_id,
            box_code,
            floor: floor || null,
          })
          .select("id")
          .single();

        if (newBoxErr) throw newBoxErr;

        box_id = String(newBox.id);
        createdBoxes++;
      }

      const itemsToInsert: any[] = [];

      for (const imei of imeis) {
        if (existingSet.has(imei)) {
          skippedExistingImeis++;
          continue;
        }

        existingSet.add(imei);

        itemsToInsert.push({
          imei,
          box_id,
          status: "IN",
          imported_at: nowIso,
          imported_by: actor_id,
        });

        insertedImeis++;
      }

      if (itemsToInsert.length > 0) {
        // 🔹 INSERT ITEMS
        const { data: insertedItems, error: itemsErr } = await supabase
          .from("items")
          .insert(itemsToInsert)
          .select("item_id");

        if (itemsErr) throw itemsErr;

        // 🔹 INSERT MOVEMENTS (1 per item)
        const movements = (insertedItems || []).map((item: any) => ({
          type: "IN",
          box_id,
          item_id: item.item_id,
          qty: 1,
          batch_id: batch.batch_id,
          created_by: actor_id,
          actor: actor || "unknown",
          created_at: nowIso,
        }));

        const { error: movErr } = await supabase
          .from("movements")
          .insert(movements);

        if (movErr) throw movErr;
      }
    }

    return NextResponse.json({
      ok: true,
      batch_id: batch.batch_id,
      totals: {
        inserted_imeis: insertedImeis,
        skipped_existing_imeis: skippedExistingImeis,
        created_boxes: createdBoxes,
        reused_boxes: reusedBoxes,
      },
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound confirm failed" },
      { status: 500 }
    );
  }
}