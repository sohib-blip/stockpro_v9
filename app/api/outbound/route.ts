import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const { imei, shipment_ref } = await req.json();

    if (!imei) {
      return NextResponse.json({ ok: false, error: "IMEI required" }, { status: 400 });
    }

    const supabase = sb();

    const { data: item } = await supabase
      .from("items")
      .select("*")
      .eq("imei", imei)
      .single();

    if (!item) {
      return NextResponse.json({ ok: false, error: "IMEI not found" }, { status: 404 });
    }

    if (item.status === "OUT") {
      return NextResponse.json({ ok: false, error: "Already shipped" }, { status: 400 });
    }

    await supabase
      .from("items")
      .update({
        status: "OUT",
        shipped_at: new Date().toISOString(),
        shipment_ref: shipment_ref || null,
      })
      .eq("item_id", item.item_id);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}