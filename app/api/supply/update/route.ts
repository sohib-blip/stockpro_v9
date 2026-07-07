import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PUT(req: Request) {
  try {
    const body = await req.json();

    const {
      id,
      from_office,
      to_office,
      tracking_number,
      status,
      comment,
      items,
    } = body;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing supply id" },
        { status: 400 }
      );
    }

    const isDone = status === "DONE";

    const updateData: any = {
      from_office,
      to_office,
      tracking_number,
      status,
      comment,
      updated_at: new Date().toISOString(),
      imported: isDone,
    };

    // Remplit Imported Date uniquement la première fois
    if (isDone) {
      const { data: current } = await supabase
        .from("supplies")
        .select("imported_date")
        .eq("id", id)
        .single();

      if (!current?.imported_date) {
        updateData.imported_date = new Date().toISOString();
      }
    } else {
      updateData.imported_date = null;
    }

    const { error } = await supabase
      .from("supplies")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;

    // On remplace complètement les lignes produits
    if (Array.isArray(items)) {
      await supabase
        .from("supply_items")
        .delete()
        .eq("supply_id", id);

      const cleanItems = items
        .filter((i: any) => i.product_name && Number(i.qty) > 0)
        .map((i: any) => ({
          supply_id: id,
          product_id: i.product_id || null,
          product_type: i.product_type,
          product_name: i.product_name,
          qty: Number(i.qty),
        }));

      if (cleanItems.length) {
        const { error: insertError } = await supabase
          .from("supply_items")
          .insert(cleanItems);

        if (insertError) throw insertError;
      }
    }

    return NextResponse.json({
      ok: true,
    });

  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Supply update failed",
      },
      { status: 500 }
    );
  }
}