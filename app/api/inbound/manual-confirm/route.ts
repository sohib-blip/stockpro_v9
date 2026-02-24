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

    const bin_id = String(body.device || "").trim();  // ✅ device = bin_id
    const box_code = String(body.box_no || "").trim(); // ✅ box_no = box_code
    const floor = String(body.floor || "").trim();     // still passed by UI
    const actor = String(body.actor || "unknown").trim();
    const imeis = cleanImeis(body.imeis);

    if (!bin_id || !box_code || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload (device(bin_id), box_no(box_code), imeis[] required)" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // ✅ ensure bin exists
    const { data: bin, error: binErr } = await supabase
      .from("bins")
      .select("id, name")
      .eq("id", bin_id)
      .maybeSingle();

    if (binErr || !bin?.id) {
      return NextResponse.json({ ok: false, error: "Bin not found" }, { status: 400 });
    }

    // duplicates check
    const { data: existing, error: existingErr } = await supabase
      .from("items")
      .select("imei")
      .in("imei", imeis);

    if (existingErr) {
      return NextResponse.json({ ok: false, error: existingErr.message }, { status: 500 });
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

    // inbound batch
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

    // find or create box by (bin_id + box_code)
    const { data: existingBox, error: boxFindErr } = await supabase
      .from("boxes")
      .select("id")
      .eq("bin_id", bin_id)
      .eq("box_code", box_code)
      .maybeSingle();

    if (boxFindErr) {
      return NextResponse.json({ ok: false, error: boxFindErr.message }, { status: 500 });
    }

    let box_id: string;

    if (existingBox?.id) {
      box_id = String(existingBox.id);
    } else {
      const { data: newBox, error: newBoxErr } = await supabase
        .from("boxes")
        .insert({
          bin_id,
          box_code,
        })
        .select("id")
        .single();

      if (newBoxErr || !newBox?.id) {
        return NextResponse.json(
          { ok: false, error: newBoxErr?.message || "Failed to create box" },
          { status: 500 }
        );
      }

      box_id = String(newBox.id);
    }

    // OPTIONAL: try save floor if the column exists (ignore if not)
    if (floor) {
      const { error: floorErr } = await supabase.from("boxes").update({ floor }).eq("id", box_id);
      if (floorErr) {
        // ignore if column doesn't exist
        if (!String(floorErr.message || "").toLowerCase().includes("column") ) {
          // only throw for real issues
          // (if it's just "column floor does not exist" we ignore)
        }
      }
    }

    const nowIso = new Date().toISOString();

    // insert items
    const items = toInsert.map((imei) => ({
      imei,
      box_id,
      status: "IN",
      imported_at: nowIso,
      imported_by: actor,
    }));

    const { error: itemsErr } = await supabase.from("items").insert(items as any);
    if (itemsErr) {
      return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 400 });
    }

    // movements
    const movements = toInsert.map((imei) => ({
      imei,
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
      bin_id,
      bin_name: bin.name,
      box_code,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Manual confirm failed" }, { status: 500 });
  }
}