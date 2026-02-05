import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function extractImeis(raw: string) {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const imeis: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const digits = l.replace(/\D/g, "");
    if (/^\d{14,17}$/.test(digits) && !seen.has(digits)) {
      seen.add(digits);
      imeis.push(digits);
    }
  }
  return imeis;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String((body as any).raw || (body as any).qr || "").trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing scan payload" }, { status: 400 });

    const supabase = adminClient();

    const imeis = extractImeis(raw);

    // si c’est un QR "ancien" BOX:...|DEV:... => on refuse, car tu veux IMEI only
    if (imeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid scan. Expected IMEI list (one per line)." },
        { status: 400 }
      );
    }

    // update items IN -> OUT
    const { data: items, error: fetchErr } = await supabase
      .from("items")
      .select("imei, box_id, status")
      .in("imei", imeis);

    if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });

    const toOut = (items || []).filter((x: any) => String(x.status).toUpperCase() === "IN").map((x: any) => x.imei);
    const affectedBoxIds = Array.from(new Set((items || []).map((x: any) => String(x.box_id)).filter(Boolean)));

    if (toOut.length) {
      const { error: updErr } = await supabase
        .from("items")
        .update({ status: "OUT" })
        .in("imei", toOut)
        .eq("status", "IN");

      if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    // update boxes status (OUT if no IN remains)
    let emptied = 0;
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

      if (nextStatus === "OUT") emptied++;
    }

    return NextResponse.json({
      ok: true,
      scanned_imeis: imeis.length,
      set_out: toOut.length,
      affected_boxes: affectedBoxIds.length,
      emptied_boxes: emptied,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}