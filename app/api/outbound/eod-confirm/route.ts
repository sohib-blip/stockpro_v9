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

export async function POST(req: Request) {
  try {
    const { imeis, shipment_ref, actor, source } = await req.json();

    if (!Array.isArray(imeis) || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No IMEIs provided" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // 🔥 GET USER FROM AUTH HEADER
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "User not authenticated" },
        { status: 401 }
      );
    }

    const actor_id = user.id;
    const actor_email = user.email || actor || "unknown";

    // ===============================
    // LOAD ITEMS
    // ===============================
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("item_id, imei, box_id, status")
      .in("imei", imeis);

    if (itemsErr) throw itemsErr;

    const validItems = (items || []).filter(
      (i: any) => i.status === "IN"
    );

    if (validItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid IN items to ship" },
        { status: 400 }
      );
    }

    // ===============================
    // CREATE OUTBOUND BATCH
    // ===============================
    const { data: batch, error: batchErr } = await supabase
      .from("outbound_batches")
      .insert({
        actor: actor_email,
        shipment_ref: shipment_ref || null,
        source: source || "manual",
      })
      .select("batch_id")
      .single();

    if (batchErr) throw batchErr;

    const nowIso = new Date().toISOString();
    const validImeis = validItems.map((i: any) => i.imei);

    // ===============================
    // UPDATE ITEMS → OUT
    // ===============================
    const { error: updErr } = await supabase
      .from("items")
      .update({
        status: "OUT",
        shipped_at: nowIso,
        shipment_ref: shipment_ref || null,
      })
      .in("imei", validImeis);

    if (updErr) throw updErr;

    // ===============================
    // INSERT MOVEMENTS (FIXED)
    // ===============================
    const movements = validItems.map((i: any) => ({
  type: "OUT",
  box_id: i.box_id,
  item_id: i.item_id,
  qty: 1,
  notes: shipment_ref || null,
  batch_id: batch.batch_id,
  actor: actor_email,
  created_by: actor_id,
  created_at: nowIso,
}));
    const { error: movErr } = await supabase
      .from("movements")
      .insert(movements);

    if (movErr) throw movErr;

    return NextResponse.json({
      ok: true,
      batch_id: batch.batch_id,
      shipped_count: validItems.length,
      skipped_count: imeis.length - validItems.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Confirm failed" },
      { status: 500 }
    );
  }
}