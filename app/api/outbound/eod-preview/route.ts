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

function cleanImeis(arr: string[]): string[] {
  return Array.from(
    new Set(
      (arr || [])
        .map((i) => String(i).replace(/\D/g, ""))
        .filter((i) => i.length === 15)
    )
  );
}

function extractImeisFromSheet(rows: any[][]): string[] {
  const imeis: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      const digits = String(cell ?? "").replace(/\D/g, "");
      if (digits.length === 15) imeis.push(digits);
    }
  }
  return Array.from(new Set(imeis));
}

export async function POST(req: Request) {
  try {
    const supabase = sb();
    const contentType = req.headers.get("content-type") || "";

    let imeis: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File;

      if (!file) {
        return NextResponse.json({ ok: false, error: "File required" });
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const wb = XLSX.read(bytes, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

      imeis = extractImeisFromSheet(rows);
    } else {
      const body = await req.json();
      imeis = cleanImeis(body.imeis || []);
    }

    if (!imeis.length) {
      return NextResponse.json({ ok: false, error: "No IMEIs detected" });
    }

    // 🔥 Charger UNIQUEMENT les IMEIs concernés
    const { data: items, error } = await supabase
      .from("items")
      .select(`
        item_id,
        imei,
        status,
        device_id,
        box_id,
        devices (
          device
        ),
        boxes (
          box_no,
          floor
        )
      `)
      .in("imei", imeis);

    if (error) throw error;

    const foundMap = new Map<string, any>();
    items?.forEach((i: any) => foundMap.set(i.imei, i));

    // ---------- SUMMARY ----------
    const summaryMap: Record<string, any> = {};
    let totalDetected = 0;

    for (const imei of imeis) {
      const item = foundMap.get(imei);
      if (!item || item.status !== "IN") continue;

      totalDetected++;

      const key = `${item.device_id}_${item.box_id}`;

      if (!summaryMap[key]) {
        // calcul total et remaining
        const { data: boxItems } = await supabase
          .from("items")
          .select("item_id, status")
          .eq("box_id", item.box_id);

        const total = boxItems?.length ?? 0;
        const remaining = boxItems?.filter((i: any) => i.status === "IN").length ?? 0;

        summaryMap[key] = {
          device: item.devices?.device || "",
          box_no: item.boxes?.box_no || "",
          floor: item.boxes?.floor || "",
          detected: 0,
          remaining,
          total,
          percent_after: 100,
        };
      }

      summaryMap[key].detected += 1;
      summaryMap[key].remaining -= 1;

      summaryMap[key].percent_after = Math.round(
        (summaryMap[key].remaining / summaryMap[key].total) * 100
      );
    }

    return NextResponse.json({
      ok: true,
      totalDetected,
      summary: Object.values(summaryMap),
      imeis, // 👈 IMPORTANT pour confirmOut
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}