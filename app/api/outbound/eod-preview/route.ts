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

    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File;

      if (!file) {
        return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
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

    const { data: items } = await supabase
      .from("items")
      .select(`
        item_id,
        imei,
        status,
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

    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const key = item.boxes?.box_code;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          device: item.boxes?.bins?.name || "—",
          box_no: item.boxes?.box_code,
          floor: item.boxes?.floor,
          detected: 0,
        };
      }

      summaryMap[key].detected += 1;
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