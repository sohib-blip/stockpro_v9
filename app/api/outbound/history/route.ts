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

export async function GET(req: Request) {
  try {

    const supabase = sb();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);

    const limit = 50;
    const offset = (page - 1) * limit;

    const { data, error } = await supabase
      .from("movements")
      .select(`
        created_at,
        actor,
        shipment_ref,
        source,
        batch_id
      `)
      .eq("type","OUT")
      .order("created_at",{ ascending:false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const batchMap: Record<string, any> = {};

    for (const row of data || []) {

      const id = String(row.batch_id || "single");

      if (!batchMap[id]) {
        batchMap[id] = {
          batch_id: id,
          created_at: row.created_at,
          actor: row.actor || "unknown",
          shipment_ref: row.shipment_ref || "",
          source: row.source || "",
          qty: 0
        };
      }

      batchMap[id].qty += 1;

    }

    return NextResponse.json({
      ok: true,
      rows: Object.values(batchMap),
      page
    });

  } catch (e:any) {

    return NextResponse.json(
      { ok:false, error:e?.message || "History failed" },
      { status:500 }
    );

  }
}