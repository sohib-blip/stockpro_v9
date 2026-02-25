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
  device?: string; // optional (debug)
  box_no: string; // box_code
  floor: string;
  imeis: string[];
};

export async function POST(req: Request) {
  try {
    const { labels, actor, vendor } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json({ ok: false, error: "No labels provided" }, { status: 400 });
    }

    const supabase = sb();

    // ✅ Validate bin_id exists
    const { data: bins, error: binsErr } = await supabase.from("bins").select("id");
    if (binsErr) throw binsErr;

    const binSet = new Set((bins || []).map((b: any) => String(b.id)));

    const unknownIds = Array.from(
      new Set(
        (labels as LabelPayload[])
          .map((l) => String(l.device_id || "").trim())
          .filter((id) => !id || !binSet.has(id))
      )
    );

    if (unknownIds.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unknown bin_id. Import blocked.",
          unknown_device_ids: unknownIds,
        },
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

    // ✅ Existing IMEIs in DB
    const { data: existingItems, error: exErr } = await supabase.from("items").select("imei");
    if (exErr) throw exErr;

    const existingSet = new Set((existingItems || []).map((x: any) => String(x.imei)));

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let skippedDuplicateInFile = 0; // ✅ NEW
    let createdBoxes = 0;
    let reusedBoxes = 0;

    const nowIso = new Date().toISOString();

    // ✅ NEW: track duplicates across the WHOLE import batch (all boxes)
    const seenInThisBatch = new Set<string>();

    for (const raw of labels as LabelPayload[]) {
      const bin_id = String(raw.device_id).trim();
      const box_code = String(raw.box_no || "").trim();
      const floor = String(raw.floor || "").trim();

      // uniq only inside current label
      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (!bin_id || !box_code || imeis.length === 0) continue;

      // Find or create box
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
            box_code,
            bin_id,
            // floor, // si tu ajoutes la colonne plus tard
          })
          .select("id")
          .single();

        if (newBoxErr) throw newBoxErr;

        box_id = String(newBox.id);
        createdBoxes += 1;
      }

      const itemsToInsert: any[] = [];

      for (const imei of imeis) {
        // ✅ duplicate INSIDE the same import file (appears in another box)
        if (seenInThisBatch.has(imei)) {
          skippedDuplicateInFile += 1;
          continue;
        }
        seenInThisBatch.add(imei);

        // ✅ already in DB
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
          // device_id: bin_id, // optionnel: ton dashboard n’en a pas besoin car il passe via boxes.bin_id
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase.from("items").insert(itemsToInsert);
        if (insErr) throw insErr;

        const movements = itemsToInsert.map(() => ({
          type: "IN",
          box_id,
          item_id: null,
          qty: 1,
          notes: floor ? `floor=${floor}` : null,
          batch_id: batch.batch_id,
          actor: actor || "unknown",
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
        skipped_duplicate_in_file: skippedDuplicateInFile, // ✅ NEW
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