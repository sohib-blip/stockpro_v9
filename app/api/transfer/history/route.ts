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

export async function GET() {
  try {
    const supabase = sb();

    const { data, error } = await supabase
      .from("movements")
      .select("created_at, actor, box_id")
      .eq("type", "TRANSFER")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({ ok: true, rows: [] });
    }

    // 🔥 Charger les boxes séparément (évite problème relation)
    const boxIds = [...new Set(data.map((d) => d.box_id))];

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, box_code, floor")
      .in("box_id", boxIds);

    const boxMap = new Map(
      boxes?.map((b) => [b.box_id, b]) || []
    );

    const rows = data.map((row) => ({
      created_at: row.created_at,
      actor: row.actor,
      box_code: boxMap.get(row.box_id)?.box_code || "-",
      floor: boxMap.get(row.box_id)?.floor || "-",
    }));

    return NextResponse.json({
      ok: true,
      rows,
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}