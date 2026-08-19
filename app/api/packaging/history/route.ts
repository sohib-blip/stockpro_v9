import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/auth";
import { packagingHistoryQuerySchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = packagingHistoryQuerySchema.safeParse({
      packaging_type_id:
        url.searchParams.get("packaging_type_id") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging history request" },
        { status: 400 }
      );
    }

    let query = supabaseService()
      .from("packaging_stock_movements")
      .select(
        "id,operation_id,packaging_type_id,movement_type,on_hand_delta,reserved_delta,on_hand_before,on_hand_after,reserved_before,reserved_after,reason,actor_email,created_at,packaging_types(code,name)"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(parsed.data.limit);

    if (parsed.data.packaging_type_id) {
      query = query.eq(
        "packaging_type_id",
        parsed.data.packaging_type_id
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (error) {
    console.error("PACKAGING HISTORY ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging history could not be loaded" },
      { status: 500 }
    );
  }
}
