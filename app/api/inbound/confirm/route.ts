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
  device_id: string;
  device?: string; // optional (debug)
  box_no: string;
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

// Validate bin_id exists (NEW SYSTEM)
const { data: bins, error: binsErr } = await supabase
  .from("bins")
  .select("id");

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

    // Create batch
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

    // Existing IMEIs
    const { data: existingItems, error: exErr } = await supabase
      .from("items")
      .select("imei");

    if (exErr) throw exErr;

    const existingSet = new Set((existingItems || []).map((x: any) => String(x.imei)));

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    const nowIso = new Date().toISOString();

    for (const raw of labels as LabelPayload[]) {
      const device_id = String(raw.device_id).trim();
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

      // Find or create box (your schema: boxes.id + boxes.bin_id + boxes.box_code)
      const { data: existingBox, error: findBoxErr } = await supabase
        .from("boxes")
        .select("id")
        .eq("bin_id", device_id)
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
            bin_id: device_id,
            // floor: floor,  // only if you have it on boxes table
          })
          .select("id")
          .single();

        if (newBoxErr) throw newBoxErr;

        box_id = String(newBox.id);
        createdBoxes += 1;
      }

      // Insert items
      const itemsToInsert: any[] = [];

      for (const imei of imeis) {
        if (existingSet.has(imei)) {
          skippedExistingImeis += 1;
          continue;
        }
        existingSet.add(imei);

        itemsToInsert.push({
          imei,
          device_id,
          box_id,
          status: "IN",
          imported_at: nowIso,
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase.from("items").insert(itemsToInsert);
        if (insErr) throw insErr;

        // Movements (your schema: movements has item_id, box_id, batch_id, actor...)
        // Here item_id is unknown unless you re-select inserted rows.
        // If you need item_id, we can do a select after insert.
        const movements = itemsToInsert.map((it) => ({
          type: "IN",
          box_id: it.box_id,
          item_id: null,
          qty: 1,
          notes: floor ? `floor=${floor}` : null,
          batch_id: batch.batch_id,
          actor: actor || "unknown",
          created_at: nowIso,
        }));

        await supabase.from("movements").insert(movements);
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
    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound confirm failed" },
      { status: 500 }
    );
  }
}