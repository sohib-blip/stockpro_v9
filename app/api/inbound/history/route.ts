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

    // 1️⃣ get inbound batches
    const { data: batches, error: bErr } = await supabase
      .from("inbound_batches")
      .select("batch_id, created_at, actor, vendor")
      .order("created_at", { ascending: false })
      .limit(200);

    if (bErr) throw bErr;

    // 2️⃣ aggregate directly from movements
    const { data: aggData, error: aggErr } = await supabase
      .from("movements")
      .select("batch_id, box_id, item_id")
      .eq("type", "IN");

    if (aggErr) throw aggErr;

    const agg: Record<
      string,
      { boxes: Set<string>; imeis: number }
    > = {};

    for (const m of aggData || []) {
      const bid = String((m as any).batch_id || "");
      if (!bid) continue;

      if (!agg[bid]) {
        agg[bid] = {
          boxes: new Set(),
          imeis: 0,
        };
      }

      agg[bid].boxes.add(String((m as any).box_id));
      agg[bid].imeis += 1;
    }

    const rows = (batches || []).map((b: any) => {
      const data = agg[String(b.batch_id)] || {
        boxes: new Set(),
        imeis: 0,
      };

      return {
        batch_id: b.batch_id,
        created_at: b.created_at,
        actor: b.actor || "unknown",
        vendor: b.vendor || "unknown",
        qty_boxes: data.boxes.size,
        qty_imeis: data.imeis,
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