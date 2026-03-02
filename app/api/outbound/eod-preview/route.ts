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

function cleanImeis(list: string[]) {
  return Array.from(
    new Set(
      list
        .map((i) => String(i).replace(/\D/g, ""))
        .filter((i) => i.length === 15)
    )
  );
}

export async function POST(req: Request) {
  try {
    const supabase = sb();

    let imeis: string[] = [];

    // ===============================
    // READ INPUT
    // ===============================
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File;

      if (!file) {
        return NextResponse.json(
          { ok: false, error: "No file uploaded" },
          { status: 400 }
        );
      }

      const text = await file.text();
      imeis = text.split(/\s+/g);
    } else {
      const body = await req.json();
      imeis = body.imeis || [];
    }

    const cleaned = cleanImeis(imeis);

    if (cleaned.length === 0) {
      return NextResponse.json({
        ok: true,
        imeis: [],
        unknown_imeis: [],
        already_out: [],
        totalDetected: 0,
        summary: [],
      });
    }

    // ===============================
    // FETCH ITEMS
    // ===============================
    const { data: items } = await supabase
      .from("items")
      .select(`
        item_id,
        imei,
        status,
        box_id,
        boxes (
          box_code,
          floor,
          bins ( name )
        )
      `)
      .in("imei", cleaned);

    const foundMap = new Map(items?.map((i: any) => [i.imei, i]) || []);

    const unknown: string[] = [];
    const alreadyOut: string[] = [];
    const valid: any[] = [];

    for (const imei of cleaned) {
      const item = foundMap.get(imei);

      if (!item) {
        unknown.push(imei);
        continue;
      }

      if (item.status !== "IN") {
        alreadyOut.push(imei);
        continue;
      }

      valid.push(item);
    }

    // ===============================
    // GET TOTAL IN PER BOX (ONCE)
    // ===============================
    const boxIds = Array.from(new Set(valid.map((v) => v.box_id)));

    const { data: totals } = await supabase
      .from("items")
      .select("box_id")
      .eq("status", "IN")
      .in("box_id", boxIds);

    const totalMap: Record<string, number> = {};

    for (const t of totals || []) {
      totalMap[t.box_id] = (totalMap[t.box_id] || 0) + 1;
    }

    // ===============================
    // BUILD SUMMARY
    // ===============================
    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const boxCode = item.boxes?.box_code;
      const boxId = item.box_id;

      if (!summaryMap[boxCode]) {
        const totalInBox = totalMap[boxId] || 0;

        summaryMap[boxCode] = {
          device: item.boxes?.bins?.name || "—",
          box_no: boxCode,
          floor: item.boxes?.floor,
          detected: 0,
          total: totalInBox,
          remaining: 0,
          percent_after: 0,
        };
      }

      summaryMap[boxCode].detected += 1;
    }

    // ===============================
    // CALCULATE REMAINING + %
    // ===============================
    for (const key in summaryMap) {
      const row = summaryMap[key];

      row.remaining = row.total - row.detected;

      row.percent_after =
        row.total > 0
          ? Math.round((row.remaining / row.total) * 100)
          : 0;
    }

    const summary = Object.values(summaryMap);

    return NextResponse.json({
      ok: true,
      imeis: valid.map((v) => v.imei),
      unknown_imeis: unknown,
      already_out: alreadyOut,
      totalDetected: cleaned.length,
      summary,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Preview failed" },
      { status: 500 }
    );
  }
}