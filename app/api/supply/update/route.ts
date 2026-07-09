import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_STATUS = ["CREATED", "SHIPPED", "RECEIVED", "IMPORTED"];

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, status, tracking_number, changed_by, changed_by_id } = body;

    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing supply id" }, { status: 400 });
    }

    if (!VALID_STATUS.includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    const isImported = status === "IMPORTED";

    const { data: currentSupply, error: currentError } = await supabase
  .from("supplies")
  .select("status")
  .eq("id", id)
  .single();

if (currentError) throw currentError;

const currentIndex = VALID_STATUS.indexOf(currentSupply.status);
const nextIndex = VALID_STATUS.indexOf(status);

if (nextIndex < currentIndex) {
  return NextResponse.json(
    { ok: false, error: "You cannot move status backwards" },
    { status: 400 }
  );
}

    const updateData: any = {
      status,
      tracking_number: tracking_number || null,
      imported: isImported,
      imported_date: isImported ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("supplies")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;

    await supabase.from("supply_status_history").insert({
      supply_id: id,
      status,
      tracking_number: tracking_number || null,
      changed_by: changed_by || "unknown",
      changed_by_id: changed_by_id || null,
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Supply update failed" },
      { status: 500 }
    );
  }
}