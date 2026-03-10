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
  device_id: string; // ici on considère que c'est le vrai devices.device_id
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

    // créer le batch
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

    // charger les IMEI existants
    const { data: existingItems, error: exErr } = await supabase
      .from("items")
      .select("imei");

    if (exErr) throw exErr;

    const existingSet = new Set(
      (existingItems || []).map((x: any) => String(x.imei))
    );

    for (const raw of labels as LabelPayload[]) {
      const device_id = String(raw.device_id || "").trim();
      const box_code = String(raw.box_no || "").trim();
      const floor = String(raw.floor || "").trim();

      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (!device_id || !box_code || imeis.length === 0) continue;

      // vérifier que le device existe
      const { data: deviceRow, error: deviceErr } = await supabase
        .from("devices")
        .select("device_id, device")
        .eq("device_id", device_id)
        .single();

      if (deviceErr) throw deviceErr;

      // trouver ou créer le bin correspondant au device
      const { data: existingBin, error: binFindErr } = await supabase
        .from("bins")
        .select("id, name")
        .eq("name", deviceRow.device)
        .maybeSingle();

      if (binFindErr) throw binFindErr;

      let bin_id: string;

      if (existingBin?.id) {
        bin_id = String(existingBin.id);
      } else {
        const { data: newBin, error: newBinErr } = await supabase
          .from("bins")
          .insert({
            name: deviceRow.device,
            min_stock: 0,
            active: true,
          })
          .select("id")
          .single();

        if (newBinErr) throw newBinErr;
        bin_id = String(newBin.id);
      }

      // trouver ou créer la box
      const { data: existingBox, error: boxFindErr } = await supabase
        .from("boxes")
        .select("id, floor")
        .eq("bin_id", bin_id)
        .eq("box_code", box_code)
        .maybeSingle();

      if (boxFindErr) throw boxFindErr;

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes += 1;

        if (floor && existingBox.floor !== floor) {
          const { error: upErr } = await supabase
            .from("boxes")
            .update({ floor })
            .eq("id", box_id);

          if (upErr) throw upErr;
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
        createdBoxes += 1;
      }

      const itemsToInsert: any[] = [];

      for (const imei of imeis) {
        if (existingSet.has(imei)) {
          skippedExistingImeis += 1;
          continue;
        }

        existingSet.add(imei);

        itemsToInsert.push({
          imei,
          box_id,
          device_id, // ✅ important : on stocke le vrai device_id
          status: "IN",
          imported_at: nowIso,
          imported_by: actor_id,
          import_id: batch.batch_id,
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { data: insertedItems, error: itemsErr } = await supabase
          .from("items")
          .insert(itemsToInsert)
          .select("item_id, imei, device_id");

        if (itemsErr) throw itemsErr;

        const movements = (insertedItems || []).map((it: any) => ({
          type: "IN",
          batch_id: batch.batch_id,
          item_id: it.item_id,
          box_id,
          device_id: it.device_id, // ✅ nouveau modèle
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
      vendor: vendor || "unknown",
      actor: actor || "unknown",
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