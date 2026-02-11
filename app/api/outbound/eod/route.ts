// app/api/outbound/eod/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/* =========================
   Supabase helpers
========================= */
function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

/* =========================
   Utils IMEI
========================= */
function normalizeImei(v: any) {
  const s = String(v ?? "").trim();
  return s.replace(/\D/g, "");
}

function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}

function extractImeisFromSheet(rows: any[][]) {
  const all: string[] = [];

  for (const r of rows) {
    if (!r) continue;
    for (const cell of r) {
      const imei = normalizeImei(cell);
      if (isLikelyImei(imei)) all.push(imei);
    }
  }

  // compute duplicates + unique
  const seen = new Set<string>();
  const dup = new Set<string>();
  const unique: string[] = [];

  for (const i of all) {
    if (seen.has(i)) {
      dup.add(i);
    } else {
      seen.add(i);
      unique.push(i);
    }
  }

  return {
    imeis_unique: unique,
    duplicates_in_file: Array.from(dup),
    detected_total_cells: all.length,
  };
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
   POST /api/outbound/eod
   FormData:
   - file: xlsx
   - mode: "preview" | "commit"
   - selected_imeis?: JSON string array (optionnel pour commit)
========================= */
export async function POST(req: Request) {
  try {
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);
    const admin = adminClient();

    // validate user token
    const { error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 401 });

    // reader/writer: admin si dispo sinon user (si RLS permet)
    const reader = admin ?? supabase;
    const writer = admin ?? supabase;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const mode = String(form.get("mode") || "preview").toLowerCase(); // preview | commit
    const selectedImeisRaw = String(form.get("selected_imeis") || "").trim();

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    if (mode !== "preview" && mode !== "commit") {
      return NextResponse.json({ ok: false, error: "Invalid mode (preview|commit)" }, { status: 400 });
    }

    // Read excel
    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    const extracted = extractImeisFromSheet(rows);
    const imeisFromFile = extracted.imeis_unique;

    if (imeisFromFile.length === 0) {
      return NextResponse.json({ ok: false, error: "No IMEIs detected in the file." }, { status: 400 });
    }

    // In commit mode: allow UI to send only selected imeis (after manual remove)
    let imeisToProcess = imeisFromFile;

    if (mode === "commit" && selectedImeisRaw) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(selectedImeisRaw);
      } catch {
        return NextResponse.json({ ok: false, error: "selected_imeis must be valid JSON array" }, { status: 400 });
      }
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ ok: false, error: "selected_imeis must be an array" }, { status: 400 });
      }
      const cleaned = parsed
        .map((x) => normalizeImei(x))
        .filter((x) => isLikelyImei(x));

      imeisToProcess = Array.from(new Set(cleaned));
      if (imeisToProcess.length === 0) {
        return NextResponse.json({ ok: false, error: "selected_imeis has no valid IMEIs" }, { status: 400 });
      }
    }

    // Fetch items in DB for those imeis
    type ItemRow = { imei: string; status: string; box_id: string | null };
    const foundItems: ItemRow[] = [];

    for (const part of chunk(imeisToProcess, 500)) {
      const { data, error } = await reader.from("items").select("imei,status,box_id").in("imei", part);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      for (const r of data || []) {
        foundItems.push({
          imei: String((r as any).imei),
          status: String((r as any).status || ""),
          box_id: ((r as any).box_id ?? null) as string | null,
        });
      }
    }

    const foundMap = new Map<string, ItemRow>();
    for (const it of foundItems) foundMap.set(it.imei, it);

    const missingImeis = imeisToProcess.filter((x) => !foundMap.has(x));

    const inStockImeis = imeisToProcess.filter((x) => {
      const it = foundMap.get(x);
      return it && String(it.status).toUpperCase() === "IN";
    });

    const notInStockImeis = imeisToProcess.filter((x) => {
      const it = foundMap.get(x);
      return it && String(it.status).toUpperCase() !== "IN";
    });

    // Group IN by box_id
    const byBox = new Map<string, { box_id: string; imeis_out: string[] }>();
    for (const imei of inStockImeis) {
      const it = foundMap.get(imei)!;
      const box_id = String(it.box_id || "");
      if (!box_id) continue;
      const g = byBox.get(box_id) || { box_id, imeis_out: [] };
      g.imeis_out.push(imei);
      byBox.set(box_id, g);
    }

    const boxIds = Array.from(byBox.keys());
    const boxesInfo = new Map<string, any>();

    if (boxIds.length > 0) {
      const { data: boxes, error: bErr } = await reader
        .from("boxes")
        .select("box_id,box_no,device,location,status")
        .in("box_id", boxIds);

      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
      for (const b of boxes || []) boxesInfo.set(String((b as any).box_id), b);
    }

    // Instead of N queries per box, fetch ALL "IN items" for these boxIds once
    const inCountByBox: Record<string, number> = {};
    if (boxIds.length > 0) {
      const { data: inItems, error: inErr } = await reader
        .from("items")
        .select("box_id")
        .in("box_id", boxIds)
        .eq("status", "IN");

      if (inErr) return NextResponse.json({ ok: false, error: inErr.message }, { status: 500 });

      for (const r of inItems || []) {
        const bid = String((r as any).box_id || "");
        if (!bid) continue;
        inCountByBox[bid] = (inCountByBox[bid] || 0) + 1;
      }
    }

    const boxPreview: any[] = [];
    for (const [box_id, g] of byBox.entries()) {
      const b = boxesInfo.get(box_id) || null;

      const total_in_before = Number(inCountByBox[box_id] || 0);
      const out_now = g.imeis_out.length;
      const remaining_after = Math.max(0, total_in_before - out_now);

      boxPreview.push({
        box_id,
        box_no: b?.box_no ?? "UNKNOWN",
        device: b?.device ?? "UNKNOWN",
        location: b?.location ?? "UNKNOWN",
        box_status: b?.status ?? null,
        total_in_before,
        out_now,
        remaining_after,
        imeis_out: g.imeis_out,
      });
    }

    boxPreview.sort(
      (a, b) =>
        String(a.device).localeCompare(String(b.device)) ||
        String(a.location).localeCompare(String(b.location)) ||
        String(a.box_no).localeCompare(String(b.box_no))
    );

    // Preview response
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        mode: "preview",
        filename: file.name,

        file_detected_total_cells: extracted.detected_total_cells,
        imeis_unique_in_file: imeisFromFile.length,
        duplicates_in_file_count: extracted.duplicates_in_file.length,
        duplicates_in_file_sample: extracted.duplicates_in_file.slice(0, 20),

        imeis_total_selected: imeisToProcess.length,
        imeis_found_in_db: foundItems.length,
        imeis_missing_count: missingImeis.length,
        imeis_not_in_stock_count: notInStockImeis.length,
        imeis_will_go_out_count: inStockImeis.length,

        missing_sample: missingImeis.slice(0, 20),
        not_in_stock_sample: notInStockImeis.slice(0, 20),

        boxes: boxPreview,
      });
    }

    // Commit mode
    if (inStockImeis.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Nothing to commit: no IN-stock IMEIs found for this selection." },
        { status: 400 }
      );
    }

    // Safety re-check: some might have moved since preview
    // We re-fetch statuses for inStockImeis
    const stillIn: string[] = [];
    const noLongerIn: string[] = [];

    for (const part of chunk(inStockImeis, 500)) {
      const { data, error } = await reader.from("items").select("imei,status").in("imei", part);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      const map = new Map<string, string>();
      for (const r of data || []) map.set(String((r as any).imei), String((r as any).status || ""));

      for (const imei of part) {
        const st = String(map.get(imei) || "").toUpperCase();
        if (st === "IN") stillIn.push(imei);
        else noLongerIn.push(imei);
      }
    }

    if (stillIn.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Commit blocked: none of the IMEIs are IN anymore (refresh preview)." },
        { status: 409 }
      );
    }

    // Update items -> OUT
    for (const part of chunk(stillIn, 500)) {
      const { error: uErr } = await writer.from("items").update({ status: "OUT" }).in("imei", part);
      if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    // Update boxes status if empty after (remaining_after == 0)
    // We recompute remaining using fresh counts after update (cheap: count IN per boxIds)
    const afterInCountByBox: Record<string, number> = {};
    if (boxIds.length > 0) {
      const { data: inItemsAfter, error: inErr2 } = await reader
        .from("items")
        .select("box_id")
        .in("box_id", boxIds)
        .eq("status", "IN");

      if (inErr2) return NextResponse.json({ ok: false, error: inErr2.message }, { status: 500 });

      for (const r of inItemsAfter || []) {
        const bid = String((r as any).box_id || "");
        if (!bid) continue;
        afterInCountByBox[bid] = (afterInCountByBox[bid] || 0) + 1;
      }
    }

    for (const b of boxPreview) {
      const remain = Number(afterInCountByBox[String(b.box_id)] || 0);
      const newStatus = remain === 0 ? "OUT" : "IN";
      await writer.from("boxes").update({ status: newStatus }).eq("box_id", b.box_id);
    }

    return NextResponse.json({
      ok: true,
      mode: "commit",
      filename: file.name,
      committed_imeis: stillIn.length,
      blocked_not_in_anymore: noLongerIn.length,
      blocked_not_in_anymore_sample: noLongerIn.slice(0, 20),

      ignored_missing: missingImeis.length,
      ignored_not_in_stock: notInStockImeis.length,

      boxes: boxPreview.map((b) => ({
        box_id: b.box_id,
        box_no: b.box_no,
        device: b.device,
        location: b.location,
        out_now: b.out_now,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}