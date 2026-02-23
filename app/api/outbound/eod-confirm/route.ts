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
    const { imeis, shipment_ref } = await req.json();
    const supabase = sb();

    const { data: items } = await supabase
      .from("items")
      .select("*")
      .in("imei", imeis);

    const validItems = items?.filter(i => i.status === "IN") || [];

    if (!validItems.length) {
      return NextResponse.json({ ok: false, error: "No valid IN items" });
    }

    // Update items
    await supabase
      .from("items")
      .update({
        status: "OUT",
        shipped_at: new Date().toISOString(),
        shipment_ref: shipment_ref || null
      })
      .in("imei", validItems.map(i => i.imei));

    // Insert movements
    const movements = validItems.map(i => ({
      imei: i.imei,
      device_id: i.device_id,
      box_id: i.box_id,
      type: "OUT",
      shipment_ref: shipment_ref || null
    }));

    await supabase.from("movements").insert(movements);

    return NextResponse.json({ ok: true, count: validItems.length });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}