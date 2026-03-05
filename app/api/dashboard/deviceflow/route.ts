import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE);
}

export async function GET() {

  const supabase = sb();

  const { data } = await supabase
    .from("movements")
    .select("device,type");

  const map: any = {};

  for (const m of data || []) {

    if (!map[m.device]) {
      map[m.device] = {
        device: m.device,
        inbound: 0,
        outbound: 0
      };
    }

    if (m.type === "IN") map[m.device].inbound++;
    if (m.type === "OUT") map[m.device].outbound++;

  }

  return NextResponse.json({
    ok: true,
    rows: Object.values(map)
  });

}