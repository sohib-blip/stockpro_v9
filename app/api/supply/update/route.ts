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
    const { id, status } = body;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing supply id" },
        { status: 400 }
      );
    }

    if (!["CREATED", "PENDING", "DONE"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 }
      );
    }

    const isDone = status === "DONE";

    const updateData: any = {
      status,
      imported: isDone,
      updated_at: new Date().toISOString(),
    };

    if (isDone) {
      updateData.imported_date = new Date().toISOString();
    } else {
      updateData.imported_date = null;
    }

    const { data, error } = await supabase
      .from("supplies")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      row: data,
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