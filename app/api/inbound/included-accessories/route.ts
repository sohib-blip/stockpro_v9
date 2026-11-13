import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Columns read from device_inbound_accessories with the accessory they add.
type IncludedAccessoryRow = {
  id: string;
  device_id: string;
  accessory_bin_id: string;
  quantity: number;
  accessory_bins: { name: string; active: boolean } | null;
};

type ActiveIncludedAccessoryRow = IncludedAccessoryRow & {
  accessory_bins: { name: string; active: boolean };
};

// Accessories included with each device model, for the inbound preview.
export async function GET() {
  try {
    const { data, error } = await serviceClient()
      .from("device_inbound_accessories")
      .select("id,device_id,accessory_bin_id,quantity,accessory_bins(name,active)")
      // Typing only: accessory_bins is many-to-one, so PostgREST returns an object.
      .overrideTypes<IncludedAccessoryRow[], { merge: false }>();
    if (error) throw error;
    const rules = (data || [])
      .filter((row): row is ActiveIncludedAccessoryRow =>
        Boolean(row.accessory_bins?.active)
      )
      .map((row) => ({
        id: row.id,
        device_id: row.device_id,
        accessory_bin_id: row.accessory_bin_id,
        accessory: row.accessory_bins.name,
        quantity: Number(row.quantity),
      }));
    return NextResponse.json({ ok: true, rules });
  } catch (error) {
    console.error("INCLUDED ACCESSORIES LIST ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Included accessories could not be loaded" },
      { status: 500 }
    );
  }
}
