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

    const bin_id = String(body.device || "").trim();
    const box_code = String(body.box_no || "").trim();
    const floor = String(body.floor || "").trim();
    const actor = String(body.actor || "unknown").trim();
    const imeis = cleanImeis(body.imeis);

    if (!bin_id || !box_code || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // Check bin exists
    const { data: bin } = await supabase
      .from("bins")
      .select("id, name")
      .eq("id", bin_id)
      .maybeSingle();

    if (!bin?.id) {
      return NextResponse.json({ ok: false, error: "Bin not found" }, { status: 400 });
    }

    // Duplicate check
    const { data: existing } = await supabase
      .from("items")
      .select("imei")
      .in("imei", imeis);

    const existingSet = new Set((existing || []).map((x: any) => x.imei));
    const toInsert = imeis.filter((i) => !existingSet.has(i));
    const skipped = imeis.filter((i) => existingSet.has(i));

    if (toInsert.length === 0) {
      return NextResponse.json({
        ok: true,
        inserted: 0,
        skipped_existing: skipped.length,
      });
    }

    // Create batch
    const { data: batch } = await supabase
      .from("inbound_batches")
      .insert({
        actor,
        vendor: "manual",
        source: "manual",
      })
      .select("batch_id, created_at")
      .single();

    if (!batch?.batch_id) {
      return NextResponse.json({ ok: false, error: "Batch creation failed" }, { status: 500 });
    }

    // Find or create box
    const { data: existingBox } = await supabase
      .from("boxes")
      .select("id")
      .eq("bin_id", bin_id)
      .eq("box_code", box_code)
      .maybeSingle();

    let box_id: string;

    if (existingBox?.id) {
      box_id = existingBox.id;
    } else {
      const { data: newBox } = await supabase
        .from("boxes")
        .insert({
          bin_id,
          box_code,
        })
        .select("id")
        .single();

      if (!newBox?.id) {
        return NextResponse.json({ ok: false, error: "Box creation failed" }, { status: 500 });
      }

      box_id = newBox.id;
    }

    const nowIso = new Date().toISOString();

    // Insert items (NO imported_by UUID now)
    const items = toInsert.map((imei) => ({
      imei,
      device_id: bin_id,   // IMPORTANT
      box_id,
      status: "IN",
      imported_at: nowIso,
      imported_by: null,   // FIX UUID ERROR
    }));

    await supabase.from("items").insert(items);

    // Insert movements (respect schema)
    const movements = toInsert.map(() => ({
      type: "IN",
      box_id,
      item_id: null,       // optional if not needed
      qty: 1,
      batch_id: batch.batch_id,
      actor,
      created_at: nowIso,
      created_by: null,    // FIX UUID ERROR
    }));

    await supabase.from("movements").insert(movements);

    return NextResponse.json({
      ok: true,
      batch_id: batch.batch_id,
      inserted: toInsert.length,
      skipped_existing: skipped.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Manual confirm failed" },
      { status: 500 }
    );
  }
}