import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function normalizeImei(v: any) {
  const s = String(v ?? "").trim();
  const digits = s.replace(/\D/g, "");
  return digits;
}

function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}

function extractImeisFromSheet(rows: any[][]) {
  const imeis: string[] = [];
  for (const r of rows) {
    if (!r) continue;
    for (const cell of r) {
      const imei = normalizeImei(cell);
      if (isLikelyImei(imei)) imeis.push(imei);
    }
  }
  // unique
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of imeis) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const mode = String(form.get("mode") || "preview"); // "preview" | "commit"

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // Read excel
    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    const imeis = extractImeisFromSheet(rows);

    if (imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "No IMEIs detected in the file." }, { status: 400 });
    }

    // Fetch items in DB for those imeis
    // Assumptions:
    // - items table has: imei, status, box_id
    // - boxes table exists and items.box_id references boxes.box_id
    // If your FK alias differs, we fallback with 2 queries.
    const chunkSize = 500;

    type ItemRow = { imei: string; status: string; box_id: string };
    const foundItems: ItemRow[] = [];

    for (let i = 0; i < imeis.length; i += chunkSize) {
      const chunk = imeis.slice(i, i + chunkSize);
      const { data, error } = await supabase.from("items").select("imei,status,box_id").in("imei", chunk);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      (data || []).forEach((r: any) => foundItems.push({ imei: String(r.imei), status: String(r.status), box_id: String(r.box_id) }));
    }

    const foundMap = new Map<string, ItemRow>();
    for (const it of foundItems) foundMap.set(it.imei, it);

    const missingImeis = imeis.filter((x) => !foundMap.has(x));
    const notInStockImeis = imeis.filter((x) => foundMap.has(x) && String(foundMap.get(x)!.status).toUpperCase() !== "IN");
    const inStockImeis = imeis.filter((x) => foundMap.has(x) && String(foundMap.get(x)!.status).toUpperCase() === "IN");

    // Group IN items by box_id
    const byBox = new Map<string, { box_id: string; imeis_out: string[] }>();
    for (const imei of inStockImeis) {
      const it = foundMap.get(imei)!;
      const g = byBox.get(it.box_id) || { box_id: it.box_id, imeis_out: [] };
      g.imeis_out.push(imei);
      byBox.set(it.box_id, g);
    }

    const boxIds = Array.from(byBox.keys());
    const boxesInfo = new Map<string, any>();
    if (boxIds.length > 0) {
      const { data: boxes, error: bErr } = await supabase
        .from("boxes")
        .select("box_id,box_no,device,location,status")
        .in("box_id", boxIds);

      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });

      for (const b of boxes || []) boxesInfo.set(String(b.box_id), b);
    }

    // Count total items IN per box, and remaining after this report
    const boxPreview: any[] = [];
    for (const [box_id, g] of byBox.entries()) {
      const { data: inCountRow, error: cErr } = await supabase
        .from("items")
        .select("imei", { count: "exact", head: true })
        .eq("box_id", box_id)
        .eq("status", "IN");

      if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

      const total_in = (inCountRow as any)?.count ?? 0;
      const out_now = g.imeis_out.length;
      const remaining = Math.max(0, Number(total_in) - Number(out_now));

      const b = boxesInfo.get(box_id) || null;

      boxPreview.push({
        box_id,
        box_no: b?.box_no ?? "UNKNOWN",
        device: b?.device ?? "UNKNOWN",
        location: b?.location ?? "UNKNOWN",
        total_in_before: total_in,
        out_now,
        remaining_after: remaining,
        imeis_out: g.imeis_out,
      });
    }

    // Sort for nicer UI
    boxPreview.sort((a, b) => String(a.device).localeCompare(String(b.device)) || String(a.box_no).localeCompare(String(b.box_no)));

    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        filename: file.name,
        imeis_total_in_file: imeis.length,
        imeis_found_in_db: foundItems.length,
        imeis_missing: missingImeis,
        imeis_not_in_stock: notInStockImeis,
        imeis_will_go_out: inStockImeis,
        boxes: boxPreview,
      });
    }

    // mode === "commit"
    // We only move IMEIs that are currently IN to OUT
    if (inStockImeis.length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to commit: no IN-stock IMEIs found in this report." }, { status: 400 });
    }

    // Update items status -> OUT
    // chunk updates
    for (let i = 0; i < inStockImeis.length; i += 500) {
      const chunk = inStockImeis.slice(i, i + 500);
      const { error: uErr } = await supabase.from("items").update({ status: "OUT" }).in("imei", chunk);
      if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    // Update boxes status if empty after
    // If remaining_after == 0 => mark OUT, else keep IN
    for (const b of boxPreview) {
      const newStatus = Number(b.remaining_after) === 0 ? "OUT" : "IN";
      await supabase.from("boxes").update({ status: newStatus }).eq("box_id", b.box_id);
    }

    return NextResponse.json({
      ok: true,
      filename: file.name,
      committed_imeis: inStockImeis.length,
      committed_boxes: boxPreview.length,
      boxes: boxPreview,
      ignored_missing: missingImeis.length,
      ignored_not_in_stock: notInStockImeis.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}