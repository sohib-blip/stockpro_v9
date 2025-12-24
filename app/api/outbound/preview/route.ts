import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function parseQrPayload(raw: string) {
  // Supported:
  // - new QR: BOX:...|DEV:...|MASTER:...|QTY:...
  // - old QR: BOX:...|DEV:...|IMEI:a,b,c
  const cleaned = raw.trim();
  const parts = cleaned.split("|");
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx > -1) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      map[k] = v;
    }
  }

  const box_no = map["BOX"] || "";
  const device = map["DEV"] || "";
  const imeiStr = map["IMEI"] || "";
  const imeis = imeiStr ? imeiStr.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const master_box_no = map["MASTER"] || "";
  return { box_no, device, master_box_no, imeis };
}

function isLikelyImei(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return /^\d{14,17}$/.test(digits);
}

function normalizeImei(raw: string) {
  return raw.replace(/\D/g, "");
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const body = await req.json().catch(() => ({}));

    // Bulk preview (manual list) - preview multiple IMEIs at once.
    const imeisInBody: string[] = Array.isArray((body as any).imeis) ? (body as any).imeis : [];
    if (imeisInBody.length > 0) {
      const imeis = imeisInBody.map((x) => String(x || "").replace(/\D/g, "")).filter((x) => /^\d{14,17}$/.test(x));
      if (imeis.length === 0) {
        return NextResponse.json({ ok: false, error: "No valid IMEIs in request" }, { status: 400 });
      }

      const { data: items, error: itemsErr } = await supabase
        .from("items")
        .select("imei,status,box_id")
        .in("imei", imeis);
      if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

      const list = (items ?? []) as Array<{ imei: string; status: string; box_id: string }>
      const foundSet = new Set(list.map((x) => x.imei));
      const missing = imeis.filter((i) => !foundSet.has(i));
      const inImeis = list.filter((x) => x.status === "IN");
      const outImeis = list.filter((x) => x.status === "OUT");

      // Group by box
      const boxIds = Array.from(new Set(list.map((x) => String(x.box_id || "")).filter(Boolean)));
      let boxesById: Record<string, any> = {};
      if (boxIds.length) {
        const { data: boxes, error: boxesErr } = await supabase
          .from("boxes")
          .select("box_id,box_no,device,status")
          .in("box_id", boxIds);
        if (!boxesErr) {
          for (const b of boxes ?? []) boxesById[String((b as any).box_id)] = b;
        }
      }

      const perBoxMap = new Map<string, { box_id: string; box_no: string | null; device: string | null; imei_in: number; imei_out: number }>();
      for (const it of list) {
        const bid = String(it.box_id || "");
        if (!bid) continue;
        const b = boxesById[bid] as any;
        const key = bid;
        const row = perBoxMap.get(key) ?? {
          box_id: bid,
          box_no: b?.box_no ?? null,
          device: b?.device ?? null,
          imei_in: 0,
          imei_out: 0,
        };
        if (it.status === "IN") row.imei_in += 1;
        else if (it.status === "OUT") row.imei_out += 1;
        perBoxMap.set(key, row);
      }

      return NextResponse.json({
        ok: true,
        mode: "bulk",
        imei_total: imeis.length,
        imei_found: list.length,
        imei_in: inImeis.length,
        imei_out: outImeis.length,
        imei_missing: missing.length,
        missing_sample: missing.slice(0, 10),
        per_box: Array.from(perBoxMap.values()).sort((a, b) => String(a.box_no || "").localeCompare(String(b.box_no || ""))),
      });
    }

    const raw = String((body as any).qr || "").trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing scan payload" }, { status: 400 });

    // If a single IMEI was scanned, preview that item.
    if (isLikelyImei(raw)) {
      const imei = normalizeImei(raw);
      const { data: itemRow, error: itemErr } = await supabase
        .from("items")
        .select("imei, status, box_id")
        .eq("imei", imei)
        .maybeSingle();

      if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
      if (!itemRow) return NextResponse.json({ ok: false, error: "IMEI not found" }, { status: 404 });

      const box_id = String((itemRow as any).box_id || "");
      const { data: boxRow } = await supabase
        .from("boxes")
        .select("box_id, box_no, device, status")
        .eq("box_id", box_id)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        mode: "imei",
        imei,
        item_status: (itemRow as any).status,
        box_id,
        box_no: (boxRow as any)?.box_no ?? null,
        device: (boxRow as any)?.device ?? null,
        box_status: (boxRow as any)?.status ?? null,
      });
    }

    const parsed = parseQrPayload(raw);
    if (!parsed.box_no || !parsed.device) {
      return NextResponse.json({ ok: false, error: "Invalid scan: expected IMEI or QR with BOX & DEV" }, { status: 400 });
    }

    // box exist?
    const { data: boxRow, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, status, box_no, device")
      .eq("box_no", parsed.box_no)
      .eq("device", parsed.device)
      .maybeSingle();

    if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    if (!boxRow) return NextResponse.json({ ok: false, error: `Box ${parsed.box_no} not found` }, { status: 404 });

    // If old QR has IMEI list, we show partial preview. Otherwise we preview the whole box.
    if (parsed.imeis.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from("items")
        .select("imei, status")
        .in("imei", parsed.imeis);
      if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

      const list = (items ?? []) as Array<{ imei: string; status: string }>;
      const foundSet = new Set(list.map((x) => x.imei));
      const imeisIn = list.filter((x) => x.status === "IN").map((x) => x.imei);
      const imeisOut = list.filter((x) => x.status === "OUT").map((x) => x.imei);
      const imeisMissing = parsed.imeis.filter((i) => !foundSet.has(i));

      return NextResponse.json({
        ok: true,
        mode: "box_partial",
        box_id: boxRow.box_id,
        box_no: boxRow.box_no,
        device: parsed.device,
        box_status: boxRow.status,
        imei_total_in_qr: parsed.imeis.length,
        imei_found_in_db: list.length,
        imei_in: imeisIn.length,
        imei_out: imeisOut.length,
        imei_missing: imeisMissing.length,
        imeis_in: imeisIn,
        imeis_out: imeisOut,
        imeis_missing: imeisMissing,
      });
    }

    const inCount = await supabase
      .from("items")
      .select("*", { count: "exact", head: true })
      .eq("box_id", boxRow.box_id)
      .eq("status", "IN");
    if (inCount.error) return NextResponse.json({ ok: false, error: inCount.error.message }, { status: 500 });

    const outCount = await supabase
      .from("items")
      .select("*", { count: "exact", head: true })
      .eq("box_id", boxRow.box_id)
      .eq("status", "OUT");
    if (outCount.error) return NextResponse.json({ ok: false, error: outCount.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      mode: "box",
      box_id: boxRow.box_id,
      box_no: boxRow.box_no,
      device: parsed.device,
      box_status: boxRow.status,
      items_in: inCount.count ?? 0,
      items_out: outCount.count ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
