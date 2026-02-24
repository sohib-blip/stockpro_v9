import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const device = searchParams.get("device");
    const box = searchParams.get("box");

    const supabase = sb();

    let query = supabase
      .from("items")
      .select(`
        imei,
        status,
        devices(device),
        boxes(id, box_code)
      `)
      .eq("status", "IN");

    if (device) {
      query = query.eq("device_id", device);
    }

    if (box) {
      query = query.eq("box_id", box);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: data ?? [],
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}