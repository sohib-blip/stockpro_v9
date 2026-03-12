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
      .from("inbound_history_view")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const rows = (data || []).map((r: any) => ({
      ...r,

      // compatibilité UI
      qty_boxes: r.qty_boxes ?? r.boxes ?? 0,
      qty_imeis: r.qty_imeis ?? r.imeis ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      rows,
      page,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}