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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    const supabase = sb();

    const { data: movs, error: movErr } = await supabase
      .from("movements")
      .select("imei, device_id, box_id, actor, created_at")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (movErr) throw movErr;

    const { data: devices } = await supabase.from("devices").select("device_id, device");
    const { data: boxes } = await supabase.from("boxes").select("box_id, box_no, floor");

    const deviceMap: Record<string, string> = {};
    for (const d of devices || []) deviceMap[String((d as any).device_id)] = (d as any).device;

    const boxMap: Record<string, { box_no: string; floor: string }> = {};
    for (const b of boxes || []) {
      boxMap[String((b as any).box_id)] = {
        box_no: (b as any).box_no,
        floor: (b as any).floor || "",
      };
    }

    const rows = (movs || []).map((m: any) => ({
      DateTime: m.created_at,
      User: m.actor || "unknown",
      Device: deviceMap[String(m.device_id)] || "",
      Box_ID: m.box_id || "",
      Box_No: boxMap[String(m.box_id)]?.box_no || "",
      Floor: boxMap[String(m.box_id)]?.floor || "",
      IMEI: m.imei || "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inbound");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="inbound_${batch_id}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Inbound export failed" },
      { status: 500 }
    );
  }
}