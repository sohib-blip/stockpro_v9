import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { count, error } = await supabaseService()
      .from("return_records")
      .select("id", { count: "exact", head: true })
      .is("template_exported_at", null);
    if (error) throw error;

    return NextResponse.json(
      { ok: true, pending: Number(count || 0) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("RETURN TEMPLATE EXPORT STATUS ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Return export status failed" },
      { status: 500 }
    );
  }
}
