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
  device_id: string; // bin_id
  box_no: string;    // box_code
  floor?: string;
  imeis: string[];
};

export async function POST(req: Request) {
  try {
    const { labels, actor, actor_id, vendor } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ ok: false, error: "No labels provided" }, { status: 400 });
    }

    if (!actor_id) {
      return NextResponse.json(
        { ok: false, error: "actor_id is required (uuid) for movements.created_by" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // ✅ Validate bin ids exist
    const { data: bins, error: binsErr } = await supabase.from("bins").select("id");
    if (binsErr) throw binsErr;

    const binSet = new Set((bins || []).map((b: any) => String(b.id)));

    const unknownBinIds = Array.from(
      new Set(
        (labels as LabelPayload[])
          .map((l) => String(l.device_id || "").trim())
          .filter((id) => !id || !binSet.has(id))
      )
    );

    if (unknownBinIds.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Unknown bin_id. Import blocked.", unknown_bin_ids: unknownBinIds },
        { status: 400 }
      );
    }

    // ✅ Create batch
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

    // ✅ Load existing IMEIs (DB)
    const { data: existingItems, error: exErr } = await supabase.from("items").select("imei");
    if (exErr) throw exErr;

    const existingSet = new Set((existingItems || []).map((x: any) => String(x.imei)));

    // ✅ Track duplicates across the whole file/import
    const seenInThisBatch = new Set<string>();

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let skippedDuplicateInFile = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    const nowIso = new Date().toISOString();

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

      // ✅ Find or create box
      const { data: existingBox, error: findBoxErr } = await supabase
        .from("boxes")
        .select("id")
        .eq("bin_id", bin_id)
        .eq("box_code", box_code)
        .maybeSingle();

      if (findBoxErr) throw findBoxErr;

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes += 1;
      } else {
        const { data: newBox, error: newBoxErr } = await supabase
          .from("boxes")
          .insert({
            bin_id,
            box_code,
            // floor, // si colonne existe sur boxes
          })
          .select("id")
          .single();

        if (newBoxErr) throw newBoxErr;
        box_id = String(newBox.id);
        createdBoxes += 1;
      }

      // ✅ Build items
      const itemsToInsert: any[] = [];

      for (const imei of imeis) {
        if (seenInThisBatch.has(imei)) {
          skippedDuplicateInFile += 1;
          continue;
        }
        seenInThisBatch.add(imei);

        if (existingSet.has(imei)) {
          skippedExistingImeis += 1;
          continue;
        }
        existingSet.add(imei);

        itemsToInsert.push({
          imei,
          box_id,
          status: "IN",
          imported_at: nowIso,
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase.from("items").insert(itemsToInsert);
        if (insErr) throw insErr;

        // ✅ movements (created_by is UUID NOT NULL)
        const movements = itemsToInsert.map(() => ({
          type: "IN",
          box_id,
          item_id: null,
          qty: 1,
          notes: floor ? `floor=${floor}` : null,
          batch_id: batch.batch_id,
          created_by: actor_id,          // ✅ UUID
          actor: actor || "unknown",     // ✅ text
          created_at: nowIso,
        }));

        const { error: movErr } = await supabase.from("movements").insert(movements);
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
        skipped_duplicate_in_file: skippedDuplicateInFile,
        created_boxes: createdBoxes,
        reused_boxes: reusedBoxes,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Inbound confirm failed" }, { status: 500 });
  }
}