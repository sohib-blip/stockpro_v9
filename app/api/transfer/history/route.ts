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

    // 🔥 on ajoute to_floor
    const { data, error } = await supabase
      .from("movements")
      .select("created_at, actor, box_id, to_floor")
      .eq("type", "TRANSFER")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      return new NextResponse(
        JSON.stringify({ ok: true, rows: [] }),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          },
        }
      );
    }

    const boxIds = [...new Set(data.map((d) => d.box_id))];

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code")
      .in("id", boxIds);

    const boxMap = new Map(
      boxes?.map((b) => [b.id, b]) || []
    );

    const rows = data.map((row) => ({
      created_at: row.created_at,
      actor: row.actor,
      boxes: {
        box_code: boxMap.get(row.box_id)?.box_code || "-",
        floor: row.to_floor || "-", // 🔥 historique réel
      },
    }));

    return new NextResponse(
      JSON.stringify({
        ok: true,
        rows,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );

  } catch (e: any) {
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: e.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  }
}