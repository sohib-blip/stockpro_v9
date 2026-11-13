import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage } from "@/lib/error-message";

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

// Columns read from movements (type OUT) and bins.
type OutboundMovementRow = {
  movement_id: string;
  operation_id: string | null;
  batch_id: string | null;
  created_at: string;
  actor: string | null;
  shipment_ref: string | null;
  source: string | null;
  qty: number;
  imei: string | null;
  device_id: string;
};

type BinRow = { id: string; name: string };

type OutboundHistoryGroup = {
  history_key: string;
  operation_id: string;
  created_at: string;
  actor: string;
  shipment_ref: string;
  source: string;
  imeisSet: Set<string>;
  devicesSet: Set<string>;
};

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);

    const limit = 50;
    const offset = (page - 1) * limit;

    const allMovements: OutboundMovementRow[] = [];
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
      new Set(allMovements.map((r) => r.device_id).filter(Boolean))
    );

    let binsData: BinRow[] = [];

    if (deviceIds.length > 0) {
      const { data, error } = await supabase
        .from("bins")
        .select("id, name")
        .in("id", deviceIds);

      if (error) throw error;
      binsData = data || [];
    }

    const binMap = new Map(
      binsData.map((b) => [String(b.id), String(b.name)])
    );

    const grouped = new Map<string, OutboundHistoryGroup>();

    for (const row of allMovements) {
      const realKey =
        row.operation_id ||
        row.batch_id ||
        row.shipment_ref ||
        row.movement_id;

      const key = String(realKey);

      let current = grouped.get(key);
      if (!current) {
        current = {
          history_key: key,
          operation_id: row.operation_id || row.batch_id || row.movement_id,
          created_at: row.created_at,
          actor: row.actor || "unknown",
          shipment_ref: row.shipment_ref || "",
          source: row.source || "manual",
          imeisSet: new Set<string>(),
          devicesSet: new Set<string>(),
        };
        grouped.set(key, current);
      }

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
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "History failed") },
      { status: 500 }
    );
  }
}