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

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json(
        { ok: false, error: "batch_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // batch info
    const { data: batch, error: bErr } = await supabase
      .from("inbound_batches")
      .select("batch_id, created_at, actor, vendor")
      .eq("batch_id", batch_id)
      .single();

    if (bErr) throw bErr;

    // movements for this batch
    const { data: movs, error: mErr } = await supabase
      .from("movements")
      .select("item_id, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (mErr) throw mErr;

    const itemIds = Array.from(
      new Set((movs || []).map((m: any) => String(m.item_id)).filter(Boolean))
    );
    const boxIds = Array.from(
      new Set((movs || []).map((m: any) => String(m.box_id)).filter(Boolean))
    );

    if (itemIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No items in this batch" },
        { status: 404 }
      );
    }

    // items
    const { data: items, error: iErr } = await supabase
      .from("items")
      .select("item_id, imei, device_id, imported_at, imported_by")
      .in("item_id", itemIds);

    if (iErr) throw iErr;

    const itemMap: Record<string, any> = {};
    for (const it of items || []) itemMap[String((it as any).item_id)] = it;

    // boxes
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id")
      .in("id", boxIds);

    if (boxErr) throw boxErr;

    const boxMap: Record<string, any> = {};
    for (const b of boxes || []) boxMap[String((b as any).id)] = b;

    // bins (device names)
    const binIds = Array.from(
      new Set((boxes || []).map((b: any) => String(b.bin_id)).filter(Boolean))
    );

    let binMap: Record<string, string> = {};
    if (binIds.length > 0) {
      const { data: bins, error: binErr } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", binIds);

      if (!binErr) {
        binMap = {};
        for (const bn of bins || []) {
          binMap[String((bn as any).id)] = String((bn as any).name);
        }
      }
    }

    // Build CSV rows (one row per movement/item)
    const header = [
      "batch_id",
      "batch_created_at",
      "actor",
      "vendor",
      "device",
      "box_code",
      "imei",
      "imported_at",
      "imported_by",
    ];

    const lines: string[] = [];
    lines.push(header.map(csvEscape).join(","));

    for (const m of movs as any[]) {
      const it = itemMap[String(m.item_id)];
      const bx = boxMap[String(m.box_id)];

      const deviceName =
        (bx?.bin_id && binMap[String(bx.bin_id)]) ||
        (it?.device_id && binMap[String(it.device_id)]) ||
        "UNKNOWN";

      lines.push(
        [
          batch.batch_id,
          batch.created_at,
          batch.actor || "unknown",
          batch.vendor || "unknown",
          deviceName,
          bx?.box_code || "",
          it?.imei || "",
          it?.imported_at || "",
          it?.imported_by || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="inbound_${batch_id}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}