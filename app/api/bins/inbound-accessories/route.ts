import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_INCLUDED_PER_DEVICE } from "@/lib/inbound-accessories";

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

function failure(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Columns read from device_inbound_accessories with the accessory they add.
type IncludedAccessoryRow = {
  id: string;
  accessory_bin_id: string;
  quantity: number;
  accessory_bins: { name: string; active: boolean } | null;
};

// Inventory Setup > Included at inbound: accessories delivered with a device
// model, added to accessory stock when those devices are received.
export async function GET(req: Request) {
  const deviceId = new URL(req.url).searchParams.get("device_id");
  if (!deviceId || !z.string().uuid().safeParse(deviceId).success) {
    return failure("Choose a device bin", 400);
  }
  try {
    const { data, error } = await serviceClient()
      .from("device_inbound_accessories")
      .select("id,accessory_bin_id,quantity,accessory_bins(name,active)")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: true })
      // Typing only: accessory_bins is many-to-one, so PostgREST returns an object.
      .overrideTypes<IncludedAccessoryRow[], { merge: false }>();
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      id: row.id,
      accessory_bin_id: row.accessory_bin_id,
      accessory: row.accessory_bins?.name || "-",
      active: Boolean(row.accessory_bins?.active),
      quantity: Number(row.quantity),
    }));
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    console.error("INBOUND ACCESSORIES LIST ERROR", error);
    return failure("Included accessories could not be loaded", 500);
  }
}

const saveSchema = z.object({
  device_id: z.string().uuid(),
  accessory_bin_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(MAX_INCLUDED_PER_DEVICE),
});

export async function POST(req: Request) {
  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return failure(`Choose an accessory and a quantity from 1 to ${MAX_INCLUDED_PER_DEVICE}`, 400);
  }
  try {
    const { error } = await serviceClient()
      .from("device_inbound_accessories")
      .upsert(parsed.data, { onConflict: "device_id,accessory_bin_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("INBOUND ACCESSORIES SAVE ERROR", error);
    return failure("Included accessory could not be saved", 500);
  }
}

export async function DELETE(req: Request) {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failure("Invalid included accessory", 400);
  try {
    const { error } = await serviceClient()
      .from("device_inbound_accessories")
      .delete()
      .eq("id", parsed.data.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("INBOUND ACCESSORIES DELETE ERROR", error);
    return failure("Included accessory could not be deleted", 500);
  }
}
