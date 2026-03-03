import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

// Nettoie et garde uniquement IMEIs 15 chiffres
function cleanImeis(list: string[]) {
  return list
    .map((i) => String(i).replace(/\D/g, ""))
    .filter((i) => i.length === 15);
}

export async function POST(req: Request) {
  try {
    const supabase = sb();

    let rawImeis: string[] = [];

    // ============================
    // 📂 IMPORT EXCEL
    // ============================
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
      const workbook = XLSX.read(buffer, { type: "buffer" });

      // Lire toutes les sheets
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

        json.forEach((row: any[]) => {
          row.forEach((cell) => {
            if (cell) rawImeis.push(String(cell));
          });
        });
      });
    } else {
      // ============================
      // 📥 IMPORT MANUAL JSON
      // ============================
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

    // ============================
    // 🔁 DETECT DUPLICATES
    // ============================
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const uniqueImeis: string[] = [];

    cleaned.forEach((imei) => {
      if (seen.has(imei)) {
        duplicates.push(imei);
      } else {
        seen.add(imei);
        uniqueImeis.push(imei);
      }
    });

    // ============================
    // 🔎 CHECK DB STATUS
    // ============================
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
      .in("imei", uniqueImeis);

    const foundMap = new Map(
      items?.map((i: any) => [i.imei, i]) || []
    );

    const unknown: string[] = [];
    const alreadyOut: string[] = [];
    const valid: any[] = [];

    uniqueImeis.forEach((imei) => {
      const item = foundMap.get(imei);

      if (!item) {
        unknown.push(imei);
        return;
      }

      if (item.status !== "IN") {
        alreadyOut.push(imei);
        return;
      }

      valid.push(item);
    });

    // ============================
    // 📊 SUMMARY PAR BOX
    // ============================
    const summaryMap: Record<string, any> = {};

    for (const item of valid) {
      const key = item.boxes?.box_code;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          device: item.boxes?.bins?.name || "",
          box_no: item.boxes?.box_code || "",
          floor: item.boxes?.floor || "",
          detected: 0,
          remaining: 0,
          percent_after: 0,
        };
      }

      summaryMap[key].detected += 1;
    }

    // Calcul remaining
    const { data: totals } = await supabase
      .from("items")
      .select("box_id, status")
      .eq("status", "IN");

    const totalMap: Record<string, number> = {};

    totals?.forEach((t: any) => {
      totalMap[t.box_id] = (totalMap[t.box_id] || 0) + 1;
    });

    Object.values(summaryMap).forEach((row: any) => {
      const boxId = items?.find(
        (i: any) => i.boxes?.box_code === row.box_no
      )?.box_id;

      const totalInBox = totalMap[boxId] || 0;

      row.remaining = totalInBox - row.detected;
      row.percent_after =
        totalInBox > 0
          ? Math.round((row.remaining / totalInBox) * 100)
          : 0;
    });

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