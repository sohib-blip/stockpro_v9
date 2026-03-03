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
      .select(`
        created_at,
        actor,
        items (
          boxes (
            box_code,
            floor
          )
        )
      `)
      .eq("type", "TRANSFER")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows =
      data?.map((row: any) => ({
        created_at: row.created_at,
        actor: row.actor,
        box_code: row.items?.boxes?.box_code,
        floor: row.items?.boxes?.floor,
      })) || [];

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