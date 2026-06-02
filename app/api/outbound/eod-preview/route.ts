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
      const workbook = XLSX.read(buffer, { type: "buffer", raw: false });

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

rawImeis = body.imeisText
  ? [String(body.imeisText)]
  : Array.isArray(body.imeis)
    ? body.imeis
    : [];
    }

    const cleaned = cleanImeis(rawImeis);

    console.log("RAW IMEIS", rawImeis);
console.log("CLEANED IMEIS", cleaned);

    if (cleaned.length === 0) {
  return NextResponse.json(
    {
      ok: false,
      error: "No valid 15-digit IMEI detected.",
      imeis: [],
      unknown_imeis: rawImeis.map((x) => String(x)),
      already_out: [],
      duplicates: [],
      totalDetected: 0,
      summary: [],
    },
    { status: 400 }
  );
}

    const counter: Record<string, number> = {};
    const uniqueImeis: string[] = [];

    for (const imei of cleaned) {
      counter[imei] = (counter[imei] || 0) + 1;
      if (counter[imei] === 1) uniqueImeis.push(imei);
    }

    const duplicates = Object.entries(counter)
      .filter(([_, count]) => count > 1)
      .map(([imei, count]) => ({ imei, count }));

    // 1) Check current stock from dashboard source
    const stockRows: any[] = [];

    for (const chunk of chunkArray(uniqueImeis, 500)) {
      const { data, error } = await supabase
        .from("stock_export_view")
        .select("item_id, imei, box_id, box_code, floor, device")
        .in("imei", chunk);

      if (error) throw error;
      stockRows.push(...(data || []));
    }

    const stockMap = new Map(
      stockRows.map((row: any) => [String(row.imei), row])
    );

    const missingImeis = uniqueImeis.filter((imei) => !stockMap.has(imei));

    // 2) Check already OUT from movements
    const outRows: any[] = [];

    for (const chunk of chunkArray(missingImeis, 500)) {
      const { data, error } = await supabase
  .from("movements")
  .select(`
    imei,
    created_at,
    shipment_ref,
    source,
    device_id,
    box_id
  `)
  .eq("type", "OUT")
  .in("imei", chunk)
  .order("created_at", { ascending: false });

      if (error) throw error;
      outRows.push(...(data || []));
    }

    const outMap = new Map<string, any>();

    for (const row of outRows) {
      const imei = String(row.imei);
      if (!outMap.has(imei)) {
        outMap.set(imei, row);
      }
    }

    const valid: any[] = [];
    const already_out: any[] = [];
    const unknown_imeis: string[] = [];

    for (const imei of uniqueImeis) {
      const stockItem = stockMap.get(imei);

      if (stockItem) {
        valid.push(stockItem);
        continue;
      }

      const outItem = outMap.get(imei);

      if (outItem) {
       already_out.push({
  imei,
  device: "-",
  box: "-",
  floor: "-",
  status: "OUT",
  shipment_ref: outItem.shipment_ref || "",
  source: outItem.source || "",
  created_at: outItem.created_at || "",
});
        continue;
      }

      unknown_imeis.push(imei);
    }

    // Summary by box
    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const key = String(item.box_id || item.box_code || item.imei);

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
      if (!row.box_id) continue;

      const { count, error } = await supabase
        .from("stock_export_view")
        .select("*", { count: "exact", head: true })
        .eq("box_id", row.box_id);

      if (error) throw error;

      const stock = count || 0;

      row.stock_before = stock;
      row.remaining = stock - row.detected;
      row.percent_after =
        stock > 0 ? Math.round((row.remaining / stock) * 100) : 0;
    }

    const hasErrors =
      duplicates.length > 0 ||
      already_out.length > 0 ||
      unknown_imeis.length > 0;

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