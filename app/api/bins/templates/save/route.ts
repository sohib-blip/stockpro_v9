import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const { error } = await supabase
      .from("device_accessory_templates")
      .upsert(
        {
          device_id,
          accessory_bin_id,
          quantity: Number(quantity || 1),
          per_devices: Number(per_devices || 1),
        },
        {
          onConflict: "device_id,accessory_bin_id",
        }
      );

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Save template failed",
      },
      { status: 500 }
    );
  }
}