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
  device_id: string; // = bin_id
  box_no: string;
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
    const operation_id = crypto.randomUUID();

    // créer batch inbound
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

    // charger IMEI existants
    const { data: existingItems, error: exErr } = await supabase
      .from("items")
      .select("imei");

    if (exErr) throw exErr;

    const existingSet = new Set(
      (existingItems || []).map((x: any) => String(x.imei))
    );

    for (const raw of labels as LabelPayload[]) {

      const bin_id = String(raw.device_id || "").trim();
      const box_code = String(raw.box_no || "").trim();
      const floor = String(raw.floor || "").trim();

      if (!bin_id || !box_code) continue;

      // vérifier que le bin existe
      const { data: binRow, error: binErr } = await supabase
        .from("bins")
        .select("id,name")
        .eq("id", bin_id)
        .maybeSingle();

      if (binErr) throw binErr;

      if (!binRow) {
        throw new Error(`Bin not found: ${bin_id}`);
      }

      // nettoyer les IMEI
      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (imeis.length === 0) continue;

      // trouver box existante
      const { data: existingBox, error: boxFindErr } = await supabase
        .from("boxes")
        .select("id,floor")
        .eq("bin_id", bin_id)
        .eq("box_code", box_code)
        .maybeSingle();

      if (boxFindErr) throw boxFindErr;

      let box_id: string;

      if (existingBox?.id) {

        box_id = String(existingBox.id);
        reusedBoxes++;

        if (floor && existingBox.floor !== floor) {

          const { error: floorErr } = await supabase
            .from("boxes")
            .update({ floor })
            .eq("id", box_id);

          if (floorErr) throw floorErr;
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
          device_id: bin_id,
          status: "IN",
          imported_at: nowIso,
          imported_by: actor_id,
          import_id: batch.batch_id,
        });

        insertedImeis++;
      }

      if (itemsToInsert.length > 0) {

        const { data: insertedItems, error: itemsErr } = await supabase
          .from("items")
          .insert(itemsToInsert)
          .select("item_id, imei");

        if (itemsErr) throw itemsErr;

        const movements = (insertedItems || []).map((it: any) => ({
  type: "IN",
  operation_id,
  batch_id: batch.batch_id,
  item_id: it.item_id,
  box_id,
  device_id: bin_id,
  imei: it.imei,
  qty: 1,
  created_by: actor_id,
  actor: actor || "unknown",
  created_at: nowIso,
  notes: vendor ? `vendor=${vendor}` : null,
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
      created_at: batch.created_at,
      totals: {
        inserted_imeis: insertedImeis,
        skipped_existing_imeis: skippedExistingImeis,
        created_boxes: createdBoxes,
        reused_boxes: reusedBoxes,
      },
    });

  } catch (e: any) {

    console.error("INBOUND CONFIRM ERROR", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound confirm failed" },
      { status: 500 }
    );
  }
}