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

function extractImeisFromSheet(rows: any[][]): string[] {
  const imeis: string[] = [];

  for (const row of rows) {
    for (const cell of row) {
      const digits = String(cell ?? "").replace(/\D/g, "");
      if (digits.length === 15) {
        imeis.push(digits);
      }
    }
  }

  return Array.from(new Set(imeis));
}

export async function POST(req: Request) {
  try {
    const supabase = sb();
    const contentType = req.headers.get("content-type") || "";

    let imeis: string[] = [];

    // Excel mode
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
    }

    // Manual mode
    else {
      const body = await req.json();
      imeis = (body.imeis || [])
        .map((i: string) => i.replace(/\D/g, ""))
        .filter((i: string) => i.length === 15);
    }

    if (!imeis.length) {
      return NextResponse.json({ ok: false, error: "No IMEIs detected" });
    }

    const { data: items } = await supabase
      .from("items")
      .select("item_id, imei, device_id, box_id, status");

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, box_no, floor");

    const deviceMap: Record<string, string> = {};
    devices?.forEach((d: any) => {
      deviceMap[d.device_id] = d.device;
    });

    const boxMap: Record<
      string,
      { box_no: string; floor: string }
    > = {};
    boxes?.forEach((b: any) => {
      boxMap[b.box_id] = {
        box_no: b.box_no,
        floor: b.floor || "",
      };
    });

    const summary: Record<
      string,
      {
        device: string;
        box_no: string;
        floor: string;
        detected: number;
        remaining: number;
        total: number;
        percent_after: number;
      }
    > = {};

    let totalDetected = 0;

    for (const imei of imeis) {
      const item = items?.find((i: any) => i.imei === imei);

      if (!item || item.status !== "IN") continue;

      totalDetected++;

      const key = `${item.device_id}_${item.box_id}`;

      const totalInBox =
        items?.filter(
          (i: any) => i.box_id === item.box_id
        ).length ?? 0;

      const remainingInBox =
        items?.filter(
          (i: any) =>
            i.box_id === item.box_id &&
            i.status === "IN"
        ).length ?? 0;

      if (!summary[key]) {
        summary[key] = {
          device: deviceMap[item.device_id] || "",
          box_no: boxMap[item.box_id]?.box_no || "",
          floor: boxMap[item.box_id]?.floor || "",
          detected: 0,
          remaining: remainingInBox,
          total: totalInBox,
          percent_after: 100,
        };
      }

      summary[key].detected += 1;
      summary[key].remaining -= 1;
      summary[key].percent_after = Math.round(
        (summary[key].remaining / summary[key].total) * 100
      );
    }

    return NextResponse.json({
      ok: true,
      totalDetected,
      summary: Object.values(summary),
      imeis,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}