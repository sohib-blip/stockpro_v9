import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);

    const limit = 50;
    const offset = (page - 1) * limit;

    let allMovements: any[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("movements")
        .select(`
          movement_id,
          operation_id,
          batch_id,
          created_at,
          actor,
          shipment_ref,
          source,
          qty,
          imei,
          device_id
        `)
        .eq("type", "OUT")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allMovements.push(...data);

      if (data.length < pageSize) break;
      from += pageSize;
    }

    const deviceIds = Array.from(
      new Set(allMovements.map((r: any) => r.device_id).filter(Boolean))
    );

    let binsData: any[] = [];

    if (deviceIds.length > 0) {
      const { data, error } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", deviceIds);

      if (error) throw error;
      binsData = data || [];
    }

    const binMap = new Map(
      binsData.map((b: any) => [String(b.id), String(b.name)])
    );

    const grouped = new Map<string, any>();

    for (const row of allMovements) {
      const realKey =
        row.operation_id ||
        row.batch_id ||
        row.shipment_ref ||
        row.movement_id;

      const key = String(realKey);

      if (!grouped.has(key)) {
        grouped.set(key, {
          history_key: key,
          operation_id: row.operation_id || row.batch_id || row.movement_id,
          created_at: row.created_at,
          actor: row.actor || "unknown",
          shipment_ref: row.shipment_ref || "",
          source: row.source || "manual",
          imeisSet: new Set<string>(),
          devicesSet: new Set<string>(),
        });
      }

      const current = grouped.get(key);

      if (row.imei) current.imeisSet.add(String(row.imei));

      const deviceName = binMap.get(String(row.device_id));
      if (deviceName) current.devicesSet.add(deviceName);

      if (new Date(row.created_at) > new Date(current.created_at)) {
        current.created_at = row.created_at;
      }
    }

    const allRows = Array.from(grouped.values())
      .map((x) => ({
        history_key: x.history_key,
        operation_id: x.operation_id,
        created_at: x.created_at,
        actor: x.actor,
        shipment_ref: x.shipment_ref,
        source: x.source,
        qty: x.imeisSet.size,
        devices: Array.from(x.devicesSet),
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
      );

    const rows = allRows.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      rows,
      page,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "History failed" },
      { status: 500 }
    );
  }
}