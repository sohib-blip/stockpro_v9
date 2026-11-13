import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";
import { errorMessage } from "@/lib/error-message";

function csv(v: unknown) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

// Columns this route requests. boxes has no box_no or device column in the
// schema (supabase/schema/staging-schema.sql), so this read currently fails.
type InStockRow = {
  imei: string | null;
  status: string | null;
  box_id: string | null;
  boxes: { box_no: string | null; device: string | null } | null;
};

async function fetchAllInStock() {
  const sb = supabaseService();
  const pageSize = 5000;
  let from = 0;
  const rows: InStockRow[] = [];

  while (true) {
    const { data, error } = await sb
      .from("items")
      .select("imei,status,box_id,boxes:boxes(box_no,device)")
      .eq("status", "IN")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    // items.box_id references one box, so PostgREST embeds an object; the
    // untyped client infers an array.
    rows.push(...(data as unknown as InStockRow[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function GET(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false, error: u.error }, { status: 401 });

  const perms = await getPermissions(u.user.id);

if (!perms.can_admin) {
  return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
}

  try {
    const rows = await fetchAllInStock();

    const deviceCounts = new Map<string, number>();
    for (const r of rows) {
      const device = r.boxes?.device ?? "";
      const key = String(device || "UNKNOWN");
      deviceCounts.set(key, (deviceCounts.get(key) ?? 0) + 1);
    }

    rows.sort((a, b) => {
      const da = String(a.boxes?.device ?? "UNKNOWN");
      const db = String(b.boxes?.device ?? "UNKNOWN");
      if (da !== db) return da.localeCompare(db);

      const ba = String(a.boxes?.box_no ?? "");
      const bb = String(b.boxes?.box_no ?? "");
      if (ba !== bb) return ba.localeCompare(bb);

      const ia = String(a.imei ?? "");
      const ib = String(b.imei ?? "");
      return ia.localeCompare(ib);
    });

    const header = ["device", "device_in_stock_qty", "box_no", "imei"].join(",");

    const body = rows
      .map((r) => {
        const b = r.boxes;
        const device = String(b?.device ?? "UNKNOWN");
        const qty = deviceCounts.get(device) ?? 0;
        const boxNo = b?.box_no ?? "";
        return [csv(device), csv(qty), csv(boxNo), csv(r.imei ?? "")].join(",");
      })
      .join("\n");

    const csvText = `${header}\n${body}\n`;

    return new NextResponse(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="in_stock_by_device_${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Export failed") }, { status: 500 });
  }
}
