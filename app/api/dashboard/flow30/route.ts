import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET() {

  const supabase = sb();

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data } = await supabase
    .from("movements")
    .select("created_at,type")
    .gte("created_at", since.toISOString());

  const map: Record<string, { inbound: number; outbound: number }> = {};

  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);

    const key = d.toISOString().slice(0,10);

    map[key] = { inbound: 0, outbound: 0 };
  }

  for (const m of data || []) {

    const date = new Date(m.created_at)
      .toISOString()
      .slice(0,10);

    if (!map[date]) continue;

    if (m.type === "IN") map[date].inbound += 1;
    if (m.type === "OUT") map[date].outbound += 1;
  }

  const rows = Object.entries(map)
    .map(([date,v]) => ({
      date,
      inbound: v.inbound,
      outbound: v.outbound
    }))
    .sort((a,b)=>a.date.localeCompare(b.date));

  return NextResponse.json({
    ok: true,
    rows
  });
}