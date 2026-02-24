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

function cleanImeis(input: any): string[] {
  const arr = Array.isArray(input) ? input : [];
  const cleaned = arr
    .map((x) => String(x ?? "").replace(/\D/g, ""))
    .filter((x) => x.length === 15);
  return Array.from(new Set(cleaned));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const device = String(body.device || "").trim();
    const box_no = String(body.box_no || "").trim();
    const floor = String(body.floor || "").trim();
    const actor = String(body.actor || "unknown").trim();
    const imeis = cleanImeis(body.imeis);

    if (!device || !box_no || !floor || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload (device, box_no, floor, imeis[] required)" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // 1) Find device_id by device name
    const { data: dev, error: devErr } = await supabase
      .from("devices")
      .select("device_id")
      .eq("device", device)
      .single();

    if (devErr || !dev?.device_id) {
      return NextResponse.json(
        { ok: false, error: `Device not found: ${device}` },
        { status: 400 }
      );
    }

    const device_id = String(dev.device_id);

    // 2) Re-check DB duplicates (safe if user skips preview)
    const { data: existing, error: existingErr } = await supabase
      .from("items")
      .select("imei")
      .in("imei", imeis);

    if (existingErr) {
      return NextResponse.json(
        { ok: false, error: existingErr.message },
        { status: 500 }
      );
    }

    const existingSet = new Set((existing || []).map((x: any) => String(x.imei)));
    const toInsert = imeis.filter((i) => !existingSet.has(i));
    const skipped = imeis.filter((i) => existingSet.has(i));

    if (toInsert.length === 0) {
      return NextResponse.json({
        ok: true,
        batch_id: null,
        inserted: 0,
        skipped_existing: skipped.length,
        skipped_list: skipped,
        box_id: null,
        message: "Nothing inserted (all IMEIs already exist).",
      });
    }

    // 3) Create inbound batch
    const { data: batch, error: batchErr } = await supabase
      .from("inbound_batches")
      .insert({
        actor,
        vendor: "manual",
        source: "manual",
      })
      .select("batch_id, created_at")
      .single();

    if (batchErr || !batch?.batch_id) {
      return NextResponse.json(
        { ok: false, error: batchErr?.message || "Failed to create inbound batch" },
        { status: 500 }
      );
    }

    // 4) Find or create box (unique by device_id + box_no)
    const { data: existingBox, error: boxFindErr } = await supabase
      .from("boxes")
      .select("box_id, floor")
      .eq("device_id", device_id)
      .eq("box_no", box_no)
      .maybeSingle();

    if (boxFindErr) {
      return NextResponse.json(
        { ok: false, error: boxFindErr.message },
        { status: 500 }
      );
    }

    let box_id: string;

    if (existingBox?.box_id) {
      box_id = String(existingBox.box_id);

      // update floor if changed
      if (floor && floor !== String(existingBox.floor || "")) {
        const { error: updErr } = await supabase
          .from("boxes")
          .update({ floor })
          .eq("box_id", box_id);
        if (updErr) {
          return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
        }
      }
    } else {
      const { data: newBox, error: newBoxErr } = await supabase
        .from("boxes")
        .insert({
          device_id,
          box_no,
          floor,
        })
        .select("box_id")
        .single();

      if (newBoxErr || !newBox?.box_id) {
        return NextResponse.json(
          { ok: false, error: newBoxErr?.message || "Failed to create box" },
          { status: 500 }
        );
      }

      box_id = String(newBox.box_id);
    }

    // 5) Insert items (only new)
    const items = toInsert.map((imei) => ({
      imei,
      device_id,
      box_id,
      status: "IN",
    }));

    const { error: itemsErr } = await supabase.from("items").insert(items as any);
    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 400 });
    }

    // 6) Insert movements
    const nowIso = new Date().toISOString();
    const movements = toInsert.map((imei) => ({
      imei,
      device_id,
      box_id,
      type: "IN",
      batch_id: batch.batch_id,
      actor,
      created_at: nowIso,
    }));

    const { error: movErr } = await supabase.from("movements").insert(movements as any);
    if (movErr) {
      return NextResponse.json({ ok: false, error: movErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      batch_id: batch.batch_id,
      inserted: toInsert.length,
      skipped_existing: skipped.length,
      skipped_list: skipped,
      box_id,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Manual confirm failed" },
      { status: 500 }
    );
  }
}