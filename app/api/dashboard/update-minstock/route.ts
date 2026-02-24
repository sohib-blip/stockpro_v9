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

export async function POST(req: Request) {
  try {
    const supabase = sb();
    const body = await req.json();

    const device_id = String(body.device_id || "").trim();
    const min_stock_raw = body.min_stock; // can be number or null

    if (!device_id) {
      return NextResponse.json({ ok: false, error: "Missing device_id" }, { status: 400 });
    }

    let min_stock: number | null = null;

    if (min_stock_raw === null || min_stock_raw === undefined || min_stock_raw === "") {
      min_stock = null;
    } else {
      const n = Number(min_stock_raw);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { ok: false, error: "min_stock must be a number >= 0 (or null)" },
          { status: 400 }
        );
      }
      min_stock = Math.floor(n);
    }

    const { error } = await supabase
      .from("devices")
      .update({ min_stock })
      .eq("device_id", device_id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Update failed" }, { status: 500 });
  }
}