import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  try {
    const supabase = sb();

    const { data: batches, error: bErr } = await supabase
      .from("inbound_batches")
      .select("batch_id, created_at, actor, vendor")
      .order("created_at", { ascending: false })
      .limit(200);

    if (bErr) throw bErr;

    const { data: movs, error: mErr } = await supabase
      .from("movements")
      .select("batch_id, box_id, item_id")
      .eq("type", "IN");

    if (mErr) throw mErr;

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, bin_id");

    const { data: bins } = await supabase
      .from("bins")
      .select("id, name");

    const boxMap: Record<string, string> = {};
    for (const b of boxes || []) {
      boxMap[String((b as any).id)] = String((b as any).bin_id);
    }

    const binMap: Record<string, string> = {};
    for (const bn of bins || []) {
      binMap[String((bn as any).id)] = String((bn as any).name);
    }

    const agg: Record<
      string,
      { boxes: Set<string>; imeis: number; devices: Set<string> }
    > = {};

    for (const m of movs || []) {
      const bid = String((m as any).batch_id || "");
      if (!bid) continue;

      if (!agg[bid]) {
        agg[bid] = {
          boxes: new Set(),
          imeis: 0,
          devices: new Set(),
        };
      }

      agg[bid].boxes.add(String((m as any).box_id));
      agg[bid].imeis += 1;

      const bin_id = boxMap[String((m as any).box_id)];
      if (bin_id && binMap[bin_id]) {
        agg[bid].devices.add(binMap[bin_id]);
      }
    }

    const rows = (batches || []).map((b: any) => {
      const data = agg[String(b.batch_id)] || {
        boxes: new Set(),
        imeis: 0,
        devices: new Set(),
      };

      return {
        batch_id: b.batch_id,
        created_at: b.created_at,
        actor: b.actor || "unknown",
        vendor: b.vendor || "unknown",
        qty_boxes: data.boxes.size,
        qty_imeis: data.imeis,
        devices: Array.from(data.devices).join(", "),
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}