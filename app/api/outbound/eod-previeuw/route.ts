import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

function extractImeis(rows: any[][]): string[] {
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
    const form = await req.formData();
    const file = form.get("file") as File;

    if (!file) {
      return NextResponse.json({ ok: false, error: "File required" });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

    const imeis = extractImeis(rows);

    const { data: items } = await supabase
      .from("items")
      .select("item_id, imei, device_id, box_id, status");

    const { data: devices } = await supabase
      .from("devices")
      .select("device_id, device");

    const { data: boxes } = await supabase
      .from("boxes")
      .select("box_id, box_no");

    const deviceMap: Record<string, string> = {};
    for (const d of devices || []) {
      deviceMap[String((d as any).device_id)] = (d as any).device;
    }

    const boxMap: Record<string, string> = {};
    for (const b of boxes || []) {
      boxMap[String((b as any).box_id)] = (b as any).box_no;
    }

    const summary: Record<
      string,
      {
        device: string;
        box_no: string;
        detected: number;
        remaining: number;
      }
    > = {};

    let totalDetected = 0;

    for (const imei of imeis) {
      const item = items?.find((i) => i.imei === imei);

      if (!item || item.status === "OUT") continue;

      totalDetected++;

      const key = `${item.device_id}_${item.box_id}`;

      if (!summary[key]) {
        const remainingInBox =
          items?.filter(
            (i) =>
              i.box_id === item.box_id &&
              i.status === "IN"
          ).length ?? 0;

        summary[key] = {
          device: deviceMap[String(item.device_id)] || "",
          box_no: boxMap[String(item.box_id)] || "",
          detected: 0,
          remaining: remainingInBox,
        };
      }

      summary[key].detected += 1;
      summary[key].remaining -= 1;
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