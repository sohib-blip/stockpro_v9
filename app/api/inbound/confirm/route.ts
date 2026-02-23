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
  device: string;
  box_no: string;
  floor: string;
  imeis: string[];
};

export async function POST(req: Request) {
  try {
    const { labels, actor, vendor } = await req.json();

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // Load devices
    const { data: devs, error: devErr } = await supabase
      .from("devices")
      .select("device_id, device");

    if (devErr) throw devErr;

    const deviceIdByName: Record<string, string> = {};
    for (const d of devs || []) {
      deviceIdByName[String((d as any).device)] = String((d as any).device_id);
    }

    // ✅ STRICT CHECK: unknown devices -> BLOCK
    const unknownDevices = Array.from(
      new Set(
        labels
          .map((l: LabelPayload) => String(l.device || "").trim())
          .filter((name: string) => name && !deviceIdByName[name])
      )
    );

    if (unknownDevices.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unknown devices found. Import blocked.",
          unknown_devices: unknownDevices,
        },
        { status: 400 }
      );
    }

    // Create inbound batch
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

    // Load existing IMEIs
    const { data: existingItems, error: exErr } = await supabase
      .from("items")
      .select("imei");

    if (exErr) throw exErr;

    const existingSet = new Set(
      (existingItems || []).map((x: any) => String(x.imei))
    );

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    const perBoxReport: Array<{
      device: string;
      box_no: string;
      floor: string;
      inserted: number;
      skipped_existing: number;
    }> = [];

    const nowIso = new Date().toISOString();

    for (const raw of labels as LabelPayload[]) {
      const deviceName = String(raw.device || "").trim();
      const box_no = String(raw.box_no || "").trim();
      const floor = String(raw.floor || "").trim();
      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (!deviceName || !box_no || imeis.length === 0) continue;

      const device_id = deviceIdByName[deviceName]; // ✅ guaranteed exists now

      // Find or create box
      const { data: existingBox, error: findBoxErr } = await supabase
        .from("boxes")
        .select("box_id, floor")
        .eq("device_id", device_id)
        .eq("box_no", box_no)
        .maybeSingle();

      if (findBoxErr) throw findBoxErr;

      let box_id: string;

      if (existingBox?.box_id) {
        box_id = String(existingBox.box_id);
        reusedBoxes += 1;

        if (floor && floor !== String(existingBox.floor || "")) {
          await supabase.from("boxes").update({ floor }).eq("box_id", box_id);
        }
      } else {
        const { data: newBox, error: newBoxErr } = await supabase
          .from("boxes")
          .insert({
            box_no,
            device_id,
            floor: floor || null,
          })
          .select("box_id")
          .single();

        if (newBoxErr) throw newBoxErr;

        box_id = String(newBox.box_id);
        createdBoxes += 1;
      }

      // Insert items (skip existing)
      const itemsToInsert: any[] = [];
      let inserted = 0;
      let skipped = 0;

      for (const imei of imeis) {
        if (existingSet.has(imei)) {
          skipped += 1;
          skippedExistingImeis += 1;
          continue;
        }
        existingSet.add(imei);

        itemsToInsert.push({
          imei,
          device_id,
          box_id,
          status: "IN",
        });

        inserted += 1;
        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("items")
          .insert(itemsToInsert as any);
        if (insErr) throw insErr;

        const movements = itemsToInsert.map((it) => ({
          imei: it.imei,
          device_id: it.device_id,
          box_id: it.box_id,
          type: "IN",
          shipment_ref: null,
          batch_id: batch.batch_id,
          actor: actor || "unknown",
          created_at: nowIso,
        }));

        const { error: movErr } = await supabase
          .from("movements")
          .insert(movements as any);
        if (movErr) throw movErr;
      }

      perBoxReport.push({
        device: deviceName,
        box_no,
        floor: floor || "",
        inserted,
        skipped_existing: skipped,
      });
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
      per_box: perBoxReport,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound confirm failed" },
      { status: 500 }
    );
  }
}