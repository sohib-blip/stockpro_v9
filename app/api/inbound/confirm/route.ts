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

    // Block unknown devices
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

    const { data: existingItems } = await supabase
      .from("items")
      .select("imei");

    const existingSet = new Set(
      (existingItems || []).map((x: any) => String(x.imei))
    );

    let insertedImeis = 0;
    let skippedExistingImeis = 0;
    let createdBoxes = 0;
    let reusedBoxes = 0;

    for (const raw of labels as LabelPayload[]) {
      const deviceName = String(raw.device || "").trim();
      const boxCode = String(raw.box_no || "").trim();
      const imeis = Array.from(
        new Set(
          (raw.imeis || [])
            .map((i) => String(i).replace(/\D/g, ""))
            .filter((i) => i.length === 15)
        )
      );

      if (!deviceName || !boxCode || imeis.length === 0) continue;

      const device_id = deviceIdByName[deviceName];

      // 🔹 Find or create box (using REAL columns)
      const { data: existingBox } = await supabase
        .from("boxes")
        .select("id")
        .eq("bin_id", device_id)
        .eq("box_code", boxCode)
        .maybeSingle();

      let box_id: string;

      if (existingBox?.id) {
        box_id = String(existingBox.id);
        reusedBoxes += 1;
      } else {
        const { data: newBox, error: newBoxErr } = await supabase
          .from("boxes")
          .insert({
            box_code: boxCode,
            bin_id: device_id,
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
          device_id,
          box_id,
          status: "IN",
        });

        insertedImeis += 1;
      }

      if (itemsToInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("items")
          .insert(itemsToInsert);

        if (insErr) throw insErr;

        const movements = itemsToInsert.map((it) => ({
          type: "IN",
          box_id: it.box_id,
          item_id: null, // optional if not used
          batch_id: batch.batch_id,
          actor: actor || "unknown",
        }));

        await supabase.from("movements").insert(movements);
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