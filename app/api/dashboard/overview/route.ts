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

type Level = "ok" | "low" | "empty";

export async function GET() {
  try {
    const supabase = sb();

    // ---- ITEMS (light) ----
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("status, device_id, box_id, imported_at, imported_by");

    if (itemsErr) throw itemsErr;

    // ---- DEVICES (bins) ----
    const { data: devices, error: devErr } = await supabase
      .from("devices")
      .select("device_id, device, min_stock")
      .order("device", { ascending: true });

    if (devErr) throw devErr;

    // ---- BOXES ----
    // On essaye avec floor, si ça fail -> fallback sans floor
    const { data: boxesWithFloor, error: boxErr } = await supabase
      .from("boxes")
      .select("id, box_code, bin_id, floor");

    let boxes: any[] = [];
    if (!boxErr) {
      boxes = (boxesWithFloor as any) || [];
    } else {
      const { data: boxesNoFloor, error: boxErr2 } = await supabase
        .from("boxes")
        .select("id, box_code, bin_id");
      if (boxErr2) throw boxErr2;

      boxes = ((boxesNoFloor as any) || []).map((b: any) => ({ ...b, floor: null }));
    }

    const itemsArr = items || [];
    const devicesArr = devices || [];

    // ---- KPI ----
    const totalIn = itemsArr.filter((i: any) => i.status === "IN").length;
    const totalOut = itemsArr.filter((i: any) => i.status === "OUT").length;

    // map device_id -> device row
    const deviceById = new Map<string, any>();
    for (const d of devicesArr) deviceById.set(String((d as any).device_id), d);

    // ---- DEVICE SUMMARY ----
    const deviceSummary =
      devicesArr.map((d: any) => {
        const device_id = String(d.device_id);

        const inCount = itemsArr.filter(
          (i: any) => String(i.device_id) === device_id && i.status === "IN"
        ).length;

        const outCount = itemsArr.filter(
          (i: any) => String(i.device_id) === device_id && i.status === "OUT"
        ).length;

        let level: Level = "ok";
        const minStock = Number(d.min_stock || 0);

        if (inCount === 0) level = "empty";
        else if (minStock > 0 && inCount <= minStock) level = "low";

        return {
          device_id,
          device: d.device,
          total_in: inCount,
          total_out: outCount,
          min_stock: minStock,
          level,
        };
      }) || [];

    const alerts = deviceSummary.filter((d: any) => d.level !== "ok").length;

    // ---- BOX SUMMARY (par box) ----
    const boxSummary =
      boxes.map((b: any) => {
        const boxId = String(b.id);

        const total = itemsArr.filter((i: any) => String(i.box_id) === boxId).length;
        const remaining = itemsArr.filter(
          (i: any) => String(i.box_id) === boxId && i.status === "IN"
        ).length;

        const percent = total > 0 ? Math.round((remaining / total) * 100) : 0;

        let level: Level = "ok";
        if (remaining === 0) level = "empty";
        else if (percent < 30) level = "low";

        const d = deviceById.get(String(b.bin_id));
        const deviceName = d?.device || "";

        return {
          box_id: boxId,
          device_id: String(b.bin_id || ""),
          device: deviceName,
          box_code: b.box_code,
          floor: b.floor || null,
          remaining,
          total,
          percent,
          level,
        };
      }) || [];

    return NextResponse.json({
      ok: true,
      kpis: {
        total_in: totalIn,
        total_out: totalOut,
        total_devices: devicesArr.length,
        total_boxes: boxes.length,
        alerts,
      },
      deviceSummary,
      boxSummary,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Dashboard overview failed" },
      { status: 500 }
    );
  }
}