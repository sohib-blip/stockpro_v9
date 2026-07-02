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
      accessory_id,
      calculation_type,
      qty,
      devices_per_qty,
    } = body;

    if (!device_id || !accessory_id) {
      return NextResponse.json(
        { ok: false, error: "device_id and accessory_id are required" },
        { status: 400 }
      );
    }

    const payload = {
      device_id,
      accessory_id,
      calculation_type: calculation_type || "per_device",
      qty: Number(qty || 1),
      devices_per_qty:
        calculation_type === "per_group" ? Number(devices_per_qty || 5) : null,
      active: true,
    };

    const { error } = await supabase
      .from("accessory_device_rules")
      .insert(payload);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Save rule failed" },
      { status: 500 }
    );
  }
}