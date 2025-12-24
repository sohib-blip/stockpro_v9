import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureProfileEmail(supabase: any, user: any) {
  try {
    const user_id = String(user?.id || "");
    const email = String(user?.email || "").trim();
    if (!user_id || !email) return;
    await supabase.from("profiles").upsert({ user_id, email }, { onConflict: "user_id" });
  } catch {
    // ignore
  }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function writeAudit(writer: any, row: any) {
  const r1 = await writer.from("audit_events").insert(row);
  if (!r1.error) return;
  await writer.from("audit_log").insert(row);
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function toList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);
    const admin = adminClient();

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 401 });
    const user = userData.user;
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    await ensureProfileEmail(supabase, user);

    const body: any = await req.json();
    const device = String(body?.device || "").trim();
    const box_nos = toList(body?.box_nos);
    const imeis = toList(body?.imeis);
    const boxMatch = (String(body?.box_match || "strict").toLowerCase() === "loose" ? "loose" : "strict") as
      | "strict"
      | "loose";

    if (!device && box_nos.length === 0 && imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "Provide device, box numbers, or IMEIs" }, { status: 400 });
    }

    // Strict mode protects against duplicate box numbers across devices.
    if (boxMatch === "strict" && box_nos.length > 0 && !device) {
      return NextResponse.json(
        { ok: false, error: "Strict mode: provide the device name when removing by box number(s)." },
        { status: 400 }
      );
    }

    // Resolve target box_ids from device and/or box_nos
    let boxIds: string[] = [];
    if (device || box_nos.length) {
      let q = supabase.from("boxes").select("box_id");
      if (device) q = q.eq("device", device);
      if (box_nos.length) q = q.in("box_no", box_nos);
      const { data: boxes, error: bErr } = await q.limit(10000);
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
      boxIds = Array.from(new Set((boxes ?? []).map((b: any) => String(b.box_id))));
    }

    // Resolve items to update (only IN)
    const itemBoxIds = boxIds.length ? boxIds : null;
    let itemsToOut: { box_id: string; imei: string }[] = [];

    if (imeis.length) {
      const { data: it, error: itErr } = await supabase
        .from("items")
        .select("box_id, imei")
        .in("imei", imeis)
        .eq("status", "IN")
        .limit(20000);
      if (itErr) return NextResponse.json({ ok: false, error: itErr.message }, { status: 500 });
      itemsToOut = (it ?? []).map((r: any) => ({ box_id: String(r.box_id), imei: String(r.imei) }));
    }

    if (itemBoxIds && itemBoxIds.length) {
      const { data: it2, error: it2Err } = await supabase
        .from("items")
        .select("box_id, imei")
        .in("box_id", itemBoxIds)
        .eq("status", "IN")
        .limit(50000);
      if (it2Err) return NextResponse.json({ ok: false, error: it2Err.message }, { status: 500 });
      for (const r of it2 ?? []) {
        itemsToOut.push({ box_id: String((r as any).box_id), imei: String((r as any).imei) });
      }
    }

    // De-duplicate by IMEI
    const seenImei = new Set<string>();
    itemsToOut = itemsToOut.filter((r) => {
      if (seenImei.has(r.imei)) return false;
      seenImei.add(r.imei);
      return true;
    });

    if (itemsToOut.length === 0) {
      return NextResponse.json({ ok: true, items_out: 0, boxes_updated: 0 });
    }

    const imeisToUpdate = itemsToOut.map((x) => x.imei);
    const affectedBoxIds = Array.from(new Set(itemsToOut.map((x) => x.box_id)));

    const { error: updErr } = await supabase
      .from("items")
      .update({ status: "OUT" })
      .in("imei", imeisToUpdate)
      .eq("status", "IN");

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

    // Update boxes status (OUT if no IN items left)
    let boxesUpdated = 0;
    const boxSummaries: any[] = [];
    for (const bid of affectedBoxIds) {
      const remaining = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", bid)
        .eq("status", "IN");

      if (remaining.error) return NextResponse.json({ ok: false, error: remaining.error.message }, { status: 500 });
      const nextStatus = (remaining.count ?? 0) === 0 ? "OUT" : "IN";
      const { error: bxErr } = await supabase.from("boxes").update({ status: nextStatus }).eq("box_id", bid);
      if (bxErr) return NextResponse.json({ ok: false, error: bxErr.message }, { status: 500 });
      boxesUpdated++;
      boxSummaries.push({ box_id: bid, device: device || null, box_status: nextStatus });
    }

    // Best effort audit (single event so history stays clean)
    try {
      const writer = admin ?? supabase;
      await writeAudit(writer, {
        action: "STOCK_OUT",
        entity: "bulk",
        // Some schemas define entity_id as uuid; keep it null for non-uuid values.
        entity_id: null,
        payload: {
          mode: "manual_list",
          device: device || null,
          box_nos,
          imeis_count: imeisToUpdate.length,
          boxes_updated: boxesUpdated,
          boxes: boxSummaries,
        },
        created_by: user.id,
      });
    } catch {}

    return NextResponse.json({ ok: true, items_out: imeisToUpdate.length, boxes_updated: boxesUpdated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
