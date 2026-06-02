import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export async function GET(req: Request) {
  try {
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
          created_at,
          actor,
          shipment_ref,
          return_type,
          return_reason,
          qty,
          imei
        `)
        .eq("type", "RETURN")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allMovements.push(...data);

      if (data.length < pageSize) break;
      from += pageSize;
    }

    const grouped = new Map<string, any>();

    for (const row of allMovements) {
      const key = String(
        row.operation_id ||
          row.shipment_ref ||
          row.movement_id
      );

      if (!grouped.has(key)) {
        grouped.set(key, {
          history_key: key,
          operation_id: row.operation_id || row.movement_id,
          created_at: row.created_at,
          actor: row.actor || "unknown",
          return_ref: row.shipment_ref || "",
          return_type: row.return_type || "",
          return_reason: row.return_reason || "",
          imeisSet: new Set<string>(),
          qty: 0,
        });
      }

      const current = grouped.get(key);

      if (row.imei) {
        current.imeisSet.add(String(row.imei));
      }

      current.qty += Number(row.qty || 1);

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
        return_ref: x.return_ref,
        return_type: x.return_type,
        return_reason: x.return_reason,
        qty: x.imeisSet.size || x.qty,
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
      { ok: false, error: e?.message || "Returns history failed" },
      { status: 500 }
    );
  }
}