import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

function cleanImeis(list: string[]) {
  return list
    .map((i) => String(i).replace(/\D/g, ""))
    .filter((i) => i.length === 15);
}

export async function POST(req: Request) {
  try {
    const supabase = sb();
    let rawImeis: string[] = [];

    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File;

      if (!file) {
        return NextResponse.json(
          { ok: false, error: "No file uploaded" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      const workbook = XLSX.read(buffer, {
        type: "buffer",
        raw: false,
      });

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];

        const json = XLSX.utils.sheet_to_json<any>(sheet, {
          raw: false,
          defval: "",
        });

        json.forEach((row: any) => {
          Object.values(row).forEach((value: any) => {
            if (!value) return;

            const str = String(value).trim();

            if (str.includes("E+")) return;

            rawImeis.push(str);
          });
        });
      });
    } else {
      const body = await req.json();
      rawImeis = body.imeis || [];
    }

    const cleaned = cleanImeis(rawImeis);

    if (cleaned.length === 0) {
      return NextResponse.json({
        ok: true,
        imeis: [],
        unknown_imeis: [],
        already_out: [],
        duplicates: [],
        totalDetected: 0,
        summary: [],
      });
    }

    const seen = new Set<string>();
    const uniqueImeis: string[] = [];
    const duplicateCounter: Record<string, number> = {};

    cleaned.forEach((imei) => {
      duplicateCounter[imei] = (duplicateCounter[imei] || 0) + 1;

      if (!seen.has(imei)) {
        seen.add(imei);
        uniqueImeis.push(imei);
      }
    });

    const duplicates = Object.entries(duplicateCounter)
      .filter(([_, count]) => count > 1)
      .map(([imei, count]) => ({
        imei,
        count,
      }));

    const { data: items, error: itemsErr } = await supabase
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
      .in("imei", uniqueImeis);

    if (itemsErr) throw itemsErr;

    const foundMap = new Map(
      items?.map((i: any) => [i.imei, i]) || []
    );

    const unknown: string[] = [];
    const alreadyOut: any[] = [];
    const valid: any[] = [];

    uniqueImeis.forEach((imei) => {
      const item = foundMap.get(imei);

      if (!item) {
        unknown.push(imei);
        return;
      }

      if (item.status !== "IN") {
        alreadyOut.push({
          imei,
          device: item.boxes?.bins?.name || "",
          box: item.boxes?.box_code || "",
          floor: item.boxes?.floor || "",
          status: item.status,
        });

        return;
      }

      valid.push(item);
    });

    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const key = item.box_id;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          device: item.boxes?.bins?.name || "",
          box_no: item.boxes?.box_code || "",
          floor: item.boxes?.floor || "",
          box_id: item.box_id,
          detected: 0,
          stock_before: 0,
          remaining: 0,
          percent_after: 0,
        };
      }

      summaryMap[key].detected += 1;
    }

    for (const row of Object.values(summaryMap) as any[]) {
      const { count, error: countErr } = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", row.box_id)
        .eq("status", "IN");

      if (countErr) throw countErr;

      const stock = count || 0;

      row.stock_before = stock;
      row.remaining = stock - row.detected;

      row.percent_after =
        stock > 0 ? Math.round((row.remaining / stock) * 100) : 0;

      if (row.remaining < 0) {
        row.warning = "Not enough stock";
      }
    }

    const hasErrors =
      unknown.length > 0 ||
      alreadyOut.length > 0 ||
      duplicates.length > 0;

    if (hasErrors) {
      return NextResponse.json(
        {
          ok: false,
          error: "Confirm blocked. Please correct the IMEI list and preview again.",
          imeis: valid.map((v) => v.imei),
          unknown_imeis: unknown,
          already_out: alreadyOut,
          duplicates,
          totalDetected: cleaned.length,
          summary: Object.values(summaryMap),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      imeis: valid.map((v) => v.imei),
      unknown_imeis: unknown,
      already_out: alreadyOut,
      duplicates,
      totalDetected: cleaned.length,
      summary: Object.values(summaryMap),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Preview failed" },
      { status: 500 }
    );
  }
}