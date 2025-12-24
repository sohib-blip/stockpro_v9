import { NextResponse } from "next/server";
import { getPermissions, requireUserFromBearer, supabaseService } from "@/lib/auth";

function csv(v: any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

async function fetchAllInventory() {
  const sb = supabaseService();
  const pageSize = 1000;
  let from = 0;
  const rows: any[] = [];

  while (true) {
    const { data, error } = await sb
      .from("items")
      .select("imei,status,created_at,updated_at,box_id,boxes:boxes(box_no,device,status,created_at)")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function GET(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false, error: u.error }, { status: 401 });

  const perms = await getPermissions(u.user.id);
  if (!perms.can_export) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const rows = await fetchAllInventory();

    const header = [
      "device",
      "box_no",
      "imei",
      "item_status",
      "box_status",
      "box_id",
      "item_created_at",
      "item_updated_at",
      "box_created_at",
    ].join(",");

    const body = rows
      .map((r) => {
        const b = (r as any).boxes;
        const device = b?.device ?? "";
        const boxNo = b?.box_no ?? "";
        const boxStatus = b?.status ?? "";
        const boxCreated = b?.created_at ?? "";
        return [
          csv(device),
          csv(boxNo),
          csv(r.imei ?? ""),
          csv(r.status ?? ""),
          csv(boxStatus),
          csv(r.box_id ?? ""),
          csv(r.created_at ?? ""),
          csv(r.updated_at ?? ""),
          csv(boxCreated),
        ].join(",");
      })
      .join("\n");

    const csvText = `${header}\n${body}\n`;

    return new NextResponse(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"inventory_${new Date().toISOString().slice(0, 10)}.csv\"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Export failed" }, { status: 500 });
  }
}
