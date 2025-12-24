import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function dayKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const days = 14;
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const sinceIso = since.toISOString();

    const { data: audits, error } = await supabase
      .from("audit_events")
      .select("created_at, action")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const buckets: Record<string, { total: number; inbound: number; outbound: number; labels: number; other: number }> =
      {};

    // init days
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      buckets[dayKey(d)] = { total: 0, inbound: 0, outbound: 0, labels: 0, other: 0 };
    }

    for (const a of audits ?? []) {
      const k = dayKey(new Date(a.created_at));
      if (!buckets[k]) continue;
      buckets[k].total++;

      const act = String(a.action || "").toUpperCase();
      if (act.includes("INBOUND") || act.includes("IMPORT")) buckets[k].inbound++;
      else if (act.includes("OUTBOUND") || act.includes("SCAN_OUT")) buckets[k].outbound++;
      else if (act.includes("LABEL")) buckets[k].labels++;
      else buckets[k].other++;
    }

    const series = Object.entries(buckets).map(([date, v]) => ({ date, ...v }));

    return NextResponse.json({ ok: true, days, series });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
