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
    .flatMap((i) => String(i ?? "").match(/\d{15}/g) || [])
    .filter((i) => i.length === 15);
}

function chunkArray<T>(arr: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
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
            rawImeis.push(String(value));
          });
        });
      });
    } else {
      const body = await req.json();
      rawImeis = Array.isArray(body.imeis) ? body.imeis : [];
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

    const counter: Record<string, number> = {};
    const uniqueImeis: string[] = [];

    for (const imei of cleaned) {
      counter[imei] = (counter[imei] || 0) + 1;

      if (counter[imei] === 1) {
        uniqueImeis.push(imei);
      }
    }

    const duplicates = Object.entries(counter)
      .filter(([_, count]) => count > 1)
      .map(([imei, count]) => ({
        imei,
        count,
      }));

    const stockRows: any[] = [];

    for (const chunk of chunkArray(uniqueImeis, 500)) {
      const { data, error } = await supabase
        .from("stock_export_view")
        .select(`
          item_id,
          imei,
          status,
          box_id,
          box_code,
          floor,
          device
        `)
        .in("imei", chunk);

      if (error) throw error;

      stockRows.push(...(data || []));
    }

    const stockMap = new Map(
      stockRows.map((item: any) => [String(item.imei), item])
    );

    const missingImeis = uniqueImeis.filter((imei) => !stockMap.has(imei));

    const itemRows: any[] = [];

    for (const chunk of chunkArray(missingImeis, 500)) {
      const { data, error } = await supabase
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
        .in("imei", chunk);

      if (error) throw error;

      itemRows.push(...(data || []));
    }

    const itemMap = new Map(
      itemRows.map((item: any) => [String(item.imei), item])
    );

    const unknown_imeis: string[] = [];
    const already_out: any[] = [];
    const valid: any[] = [];

    for (const imei of uniqueImeis) {
      const stockItem = stockMap.get(imei);

      if (stockItem) {
        valid.push(stockItem);
        continue;
      }

      const item = itemMap.get(imei);

      if (!item) {
        unknown_imeis.push(imei);
        continue;
      }

      already_out.push({
        imei,
        device: item.boxes?.bins?.name || "",
        box: item.boxes?.box_code || "",
        floor: item.boxes?.floor || "",
        status: item.status || "",
      });
    }

    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const key = item.box_id;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          device: item.device || "",
          box_no: item.box_code || "",
          floor: item.floor || "",
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
      const { count, error } = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", row.box_id)
        .eq("status", "IN");

      if (error) throw error;

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
      duplicates.length > 0 ||
      unknown_imeis.length > 0 ||
      already_out.length > 0;

    return NextResponse.json(
      {
        ok: !hasErrors,
        error: hasErrors
          ? "Confirm blocked. Please correct duplicate, unknown or already outbound IMEIs."
          : null,
        imeis: valid.map((v) => v.imei),
        unknown_imeis,
        already_out,
        duplicates,
        totalDetected: cleaned.length,
        summary: Object.values(summaryMap),
      },
      { status: hasErrors ? 400 : 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Preview failed" },
      { status: 500 }
    );
  }
}