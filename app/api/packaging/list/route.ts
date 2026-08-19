import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/auth";
import { packagingAvailableStock } from "@/lib/packaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const includeHidden =
      new URL(req.url).searchParams.get("include_hidden") === "1";
    let query = supabaseService()
      .from("packaging_types")
      .select(
        "id,code,name,category,length_cm,width_cm,height_cm,on_hand_stock,reserved_stock,minimum_stock,active,sort_order,created_at,updated_at"
      )
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (!includeHidden) query = query.eq("active", true);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: (data || []).map((row) => ({
        ...row,
        length_cm: Number(row.length_cm),
        width_cm: Number(row.width_cm),
        height_cm: Number(row.height_cm),
        on_hand_stock: Number(row.on_hand_stock || 0),
        reserved_stock: Number(row.reserved_stock || 0),
        minimum_stock: Number(row.minimum_stock || 0),
        available_stock: packagingAvailableStock(
          Number(row.on_hand_stock || 0),
          Number(row.reserved_stock || 0)
        ),
      })),
    });
  } catch (error) {
    console.error("PACKAGING LIST ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging inventory could not be loaded" },
      { status: 500 }
    );
  }
}
