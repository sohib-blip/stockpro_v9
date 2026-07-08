import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing supply id" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("supply_status_history")
      .select("*")
      .eq("supply_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: data || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Supply history failed" },
      { status: 500 }
    );
  }
}