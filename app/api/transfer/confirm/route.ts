import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  try {
    const { item_ids, target_box_id, actor, actor_id } = await req.json();

    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return NextResponse.json({ ok: false, error: "No items provided" });
    }

    if (!target_box_id) {
      return NextResponse.json({ ok: false, error: "Target box required" });
    }

    if (!actor_id) {
      return NextResponse.json({
        ok: false,
        error: "actor_id required (uuid)"
      });
    }

    const nowIso = new Date().toISOString();

    // 1️⃣ Update items
    const { error: updateErr } = await supabase
      .from("items")
      .update({ box_id: target_box_id })
      .in("item_id", item_ids);

    if (updateErr) throw updateErr;

    // 2️⃣ Create transfer batch
    const { data: batch, error: batchErr } = await supabase
      .from("transfer_batches")
      .insert({
        actor: actor || "unknown",
      })
      .select("batch_id")
      .single();

    if (batchErr) throw batchErr;

    // 3️⃣ Insert movement logs
    const movements = item_ids.map((item_id: string) => ({
      type: "TRANSFER",
      item_id,
      box_id: target_box_id,
      qty: 1,
      batch_id: batch.batch_id,
      created_by: actor_id,
      actor: actor || "unknown",
      created_at: nowIso,
    }));

    const { error: movErr } = await supabase
      .from("movements")
      .insert(movements);

    if (movErr) throw movErr;

    return NextResponse.json({
      ok: true,
      moved: item_ids.length,
      batch_id: batch.batch_id
    });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "Transfer failed"
    });
  }
}