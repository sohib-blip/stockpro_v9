import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  authorizeCapabilityRequest,
  supabaseService,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const authorization = await authorizeCapabilityRequest(
    req,
    "inventory.export.raw"
  );
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status }
    );
  }

  try {
    const supabase = supabaseService();
    let allRows: any[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from("stock_export_view")
        .select("item_id,floor,device,box_code,imei")
        .order("item_id", { ascending: true })
        .range(from, to);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 }
        );
      }

      if (!data || data.length === 0) break;

      allRows.push(...data);

      if (data.length < pageSize) break;
      page++;
    }

    const rows = allRows.map((r: any) => ({
      floor: r.floor || "",
      device: r.device || "",
      box_code: r.box_code || "",
      imei: r.imei || "",
    }));

    rows.sort((a, b) => {
      if (String(a.floor) !== String(b.floor)) {
        return String(a.floor).localeCompare(String(b.floor));
      }

      if (a.device !== b.device) {
        return a.device.localeCompare(b.device);
      }

      if (a.box_code !== b.box_code) {
        return a.box_code.localeCompare(b.box_code, undefined, {
          numeric: true,
        });
      }

      return a.imei.localeCompare(b.imei);
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    ws["!cols"] = [
      { wch: 10 },
      { wch: 20 },
      { wch: 12 },
      { wch: 22 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=stock_export.xlsx`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}
