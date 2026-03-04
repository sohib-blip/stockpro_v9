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

export async function GET() {

  const supabase = sb();

  const { data } = await supabase
    .from("movements")
    .select("created_at,type,device")
    .gte("created_at", new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString());

  const map: Record<string, any> = {};

for (const m of data || []) {

  const date = new Date(m.created_at).toISOString().slice(0,10);
  const device = m.device || "unknown";

  if (!map[date]) map[date] = { date };

  const key = device + "_" + m.type;

  if (!map[date][key]) map[date][key] = 0;

  map[date][key] += 1;
}

  const rows = Object.entries(map)
    .map(([date, v]) => ({
      date,
      inbound: v.inbound,
      outbound: v.outbound,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({
    ok: true,
    rows
  });
}