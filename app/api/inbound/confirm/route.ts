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
        { ok: false, error: "actor_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

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

    const nowIso = new Date().toISOString();

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    const { data: existingItems } = await supabase.from("items").select("imei");
    const existingSet = new Set((existingItems || []).map((x: any) => String(x.imei)));

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

      // 🔹 Find or create box
      const { data: existingBox } = await supabase
        .from("boxes")
        .select("id, floor")
        .eq("bin_id", bin_id)
        .eq("box_code", box_code)
        .maybeSingle();

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes += 1;

        // ✅ UPDATE FLOOR IF PROVIDED
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
            floor: floor || null,   // ✅ FLOOR WRITTEN HERE
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
          status: "IN",
          imported_at: nowIso,
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        await supabase.from("items").insert(itemsToInsert);

        await supabase.from("movements").insert(
          itemsToInsert.map(() => ({
            type: "IN",
            box_id,
            qty: 1,
            batch_id: batch.batch_id,
            created_by: actor_id,
            actor: actor || "unknown",
            created_at: nowIso,
          }))
        );
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