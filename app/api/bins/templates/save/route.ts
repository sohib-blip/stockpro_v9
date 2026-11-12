import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage } from "@/lib/error-message";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      device_id,
      accessory_bin_id,
      quantity,
      per_devices,
      per_order,
    } = body;

    if (!device_id || !accessory_bin_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "device_id and accessory_bin_id required",
        },
        { status: 400 }
      );
    }

    // Saving a rule that already exists for this model and accessory updates it.
    const { data: existing, error: existingError } = await supabase
      .from("device_accessory_templates")
      .select("id")
      .eq("device_id", device_id)
      .eq("accessory_bin_id", accessory_bin_id)
      .limit(1);

    if (existingError) throw existingError;

    const { error } = await supabase
      .from("device_accessory_templates")
      .upsert(
        {
          device_id,
          accessory_bin_id,
          quantity: Number(quantity || 1),
          per_devices: Number(per_devices || 1),
          // Once per order that contains this device model.
          per_order: per_order === true,
        },
        {
          onConflict: "device_id,accessory_bin_id",
        }
      );

    if (error) throw error;

    return NextResponse.json({ ok: true, updated: (existing || []).length > 0 });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage(e, "Save template failed"),
      },
      { status: 500 }
    );
  }
}