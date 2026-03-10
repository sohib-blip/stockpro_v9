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
    const { imeis, shipment_ref, actor, actor_id, source } = await req.json();

    if (!actor_id) {
      return NextResponse.json(
        { ok: false, error: "Missing actor_id" },
        { status: 400 }
      );
    }

    if (!Array.isArray(imeis) || imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No IMEIs provided" },
        { status: 400 }
      );
    }

    const supabase = sb();

    const { data, error } = await supabase.rpc("confirm_outbound_batch", {
      p_imeis: imeis,
      p_actor: actor || "unknown",
      p_actor_id: actor_id,
      p_shipment_ref: shipment_ref || null,
      p_source: source || "manual",
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (e: any) {
    console.error("OUTBOUND CONFIRM ERROR", e);

    return NextResponse.json(
      { ok: false, error: e?.message || "Confirm failed" },
      { status: 500 }
    );
  }
}