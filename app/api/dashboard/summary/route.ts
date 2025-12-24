import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAuthed(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function buildSummary(token: string) {
  const supabase = supabaseAuthed(token);

  // counts (best-effort for audit tables)
  const boxesCount = await supabase.from("boxes").select("*", { count: "exact", head: true });
  const itemsCount = await supabase.from("items").select("*", { count: "exact", head: true });

  let audits = 0;
  const auditsCount1 = await supabase.from("audit_log").select("*", { count: "exact", head: true });
  if (!auditsCount1.error) audits = auditsCount1.count ?? 0;
  const auditsCount2 = await supabase.from("audit_events").select("*", { count: "exact", head: true });
  if (!auditsCount2.error) audits = Math.max(audits, auditsCount2.count ?? 0);

  const counts: any = {
    boxes: boxesCount.count ?? 0,
    items: itemsCount.count ?? 0,
    audits,
  };

  // per device IN/OUT stock using boxes.device via box_id
  const boxesRes = await supabase.from("boxes").select("box_id, device").limit(50000);
  if (boxesRes.error) {
    return { ok: false, error: boxesRes.error.message };
  }

  const boxIdToDevice = new Map<string, string>();
  for (const b of boxesRes.data ?? []) {
    if (b?.box_id) boxIdToDevice.set(String(b.box_id), String((b as any).device ?? ""));
  }

  const itemsRes = await supabase.from("items").select("box_id, status").limit(50000);
  if (itemsRes.error) {
    return { ok: false, error: itemsRes.error.message };
  }

  let items_in = 0;
  let items_out = 0;
  const per = new Map<string, { in_stock: number; out_stock: number }>();

  for (const it of itemsRes.data ?? []) {
    const status = String((it as any).status ?? "").toUpperCase();
    const boxId = String((it as any).box_id ?? "");
    const dev = boxIdToDevice.get(boxId) || "";
    const key = dev || "UNKNOWN";

    const curr = per.get(key) ?? { in_stock: 0, out_stock: 0 };
    if (status === "IN") {
      curr.in_stock++;
      items_in++;
    } else if (status === "OUT") {
      curr.out_stock++;
      items_out++;
    }
    per.set(key, curr);
  }

  // Boxes IN/OUT (best-effort: only if status column exists)
  let boxes_in = 0;
  let boxes_out = 0;
  const boxesStatus = await supabase.from("boxes").select("status", { count: "exact" }).limit(50000);
  if (!boxesStatus.error) {
    for (const b of (boxesStatus.data as any[]) ?? []) {
      const s = String(b?.status ?? "").toUpperCase();
      if (s === "IN") boxes_in++;
      else if (s === "OUT") boxes_out++;
    }
  }

  counts.items_in = items_in;
  counts.items_out = items_out;
  counts.boxes_in = boxes_in;
  counts.boxes_out = boxes_out;
  counts.devices = new Set(Array.from(boxIdToDevice.values()).filter(Boolean)).size;

  const per_device = Array.from(per.entries())
    .map(([device, v]) => ({ device, in_stock: v.in_stock, out_stock: v.out_stock, total: v.in_stock + v.out_stock }))
    .sort((a, b) => b.total - a.total);

  return { ok: true, counts, per_device };
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

  const summary = await buildSummary(token);
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

  const summary = await buildSummary(token);
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}
