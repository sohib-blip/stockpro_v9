import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApiIdentity } from "@/lib/api-identity";
import { buildInboundMovementRows } from "@/lib/inbound/movements";

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

type NormalizedLabel = {
  binId: string;
  boxCode: string;
  floor: string;
  imeis: string[];
};

const STOCK_QUERY_CHUNK_SIZE = 200;

function cleanImeis(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => String(value).replace(/\D/g, ""))
        .filter((value) => value.length === 15)
    )
  );
}

async function findExistingImeis(
  supabase: ReturnType<typeof sb>,
  imeis: string[]
) {
  const existing = new Set<string>();

  for (let index = 0; index < imeis.length; index += STOCK_QUERY_CHUNK_SIZE) {
    const chunk = imeis.slice(index, index + STOCK_QUERY_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("items")
      .select("imei")
      .in("imei", chunk);

    if (error) throw error;
    for (const row of data || []) existing.add(String(row.imei));
  }

  return existing;
}

export async function POST(req: Request) {
  try {
    const { labels, vendor, shipment_ref } = await req.json();
    const identity = getApiIdentity(req);

    if (!Array.isArray(labels) || labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No labels provided" },
        { status: 400 }
      );
    }

    const supabase = sb();
    const nowIso = new Date().toISOString();
    const operation_id = crypto.randomUUID();

    const normalizedLabels: NormalizedLabel[] = (labels as LabelPayload[])
      .map((raw) => ({
        binId: String(raw.device_id || "").trim(),
        boxCode: String(raw.box_no || "").trim(),
        floor: String(raw.floor || "").trim(),
        imeis: cleanImeis(raw.imeis),
      }))
      .filter((label) => label.binId && label.boxCode && label.imeis.length > 0);

    if (normalizedLabels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid boxes or 15-digit IMEIs were found" },
        { status: 400 }
      );
    }

    const binIds = Array.from(
      new Set(normalizedLabels.map((label) => label.binId))
    );
    const { data: bins, error: binsError } = await supabase
      .from("bins")
      .select("id")
      .in("id", binIds);

    if (binsError) throw binsError;
    const existingBinIds = new Set((bins || []).map((bin) => String(bin.id)));
    const missingBinIds = binIds.filter((binId) => !existingBinIds.has(binId));
    if (missingBinIds.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Bins not found: ${missingBinIds.join(", ")}` },
        { status: 400 }
      );
    }

    const allImeis = Array.from(
      new Set(normalizedLabels.flatMap((label) => label.imeis))
    );
    const existingSet = await findExistingImeis(supabase, allImeis);
    const newImeis = allImeis.filter((imei) => !existingSet.has(imei));

    if (newImeis.length === 0) {
      const imeiLabel = `${allImeis.length} ${allImeis.length === 1 ? "IMEI" : "IMEIs"}`;
      return NextResponse.json(
        {
          ok: false,
          code: "ALL_IMEIS_ALREADY_IN_STOCK",
          error: `Import blocked: all ${imeiLabel} from this spreadsheet ${allImeis.length === 1 ? "is" : "are"} already in stock. Nothing was imported and no history was created.`,
          totals: {
            inserted_imeis: 0,
            skipped_existing_imeis: allImeis.length,
            created_boxes: 0,
            reused_boxes: 0,
          },
        },
        { status: 409 }
      );
    }

    // Create history only after the preflight proves there is stock to import.
    const { data: batch, error: batchErr } = await supabase
      .from("inbound_batches")
      .insert({
        actor: identity.email,
        vendor: vendor || "unknown",
        source: "excel",
        shipment_ref: shipment_ref || null,
      })
      .select("batch_id, created_at")
      .single();

    if (batchErr) throw batchErr;

    let insertedImeis = 0;
    const skippedExistingImeis = existingSet.size;
    let createdBoxes = 0;
    let reusedBoxes = 0;
    const claimedNewImeis = new Set<string>();

    for (const label of normalizedLabels) {
      const bin_id = label.binId;
      const box_code = label.boxCode;
      const floor = label.floor;
      const imeis = label.imeis.filter((imei) => {
        if (existingSet.has(imei) || claimedNewImeis.has(imei)) return false;
        claimedNewImeis.add(imei);
        return true;
      });

      // Do not create, reuse or move a box when this label contains no new stock.
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
        itemsToInsert.push({
          imei,
          box_id,
          device_id: bin_id,
          status: "IN",
          imported_at: nowIso,
          imported_by: identity.userId,
          import_id: batch.batch_id,
        });
      }

      if (itemsToInsert.length > 0) {
        const { data: insertedItems, error: itemsErr } = await supabase
          .from("items")
          .insert(itemsToInsert)
          .select("item_id, imei");

        if (itemsErr) throw itemsErr;
        insertedImeis += insertedItems?.length || 0;

        const movements = buildInboundMovementRows(insertedItems || [], {
          operationId: operation_id,
          batchId: batch.batch_id,
          boxId: box_id,
          binId: bin_id,
          actorId: identity.userId,
          actor: identity.email,
          createdAt: nowIso,
          notes: vendor ? `vendor=${vendor}` : null,
        });

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
