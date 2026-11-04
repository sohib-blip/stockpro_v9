import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  returnCountryLabel,
  returnCourierLabel,
  returnStatusLabel,
  returnStockActionLabel,
} from "@/lib/returns";
import {
  readAllPages,
  readInChunks,
  rowsOrThrow,
} from "@/lib/supabase/read-all-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function formatReturnDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function locationLabel(box?: string | null, floor?: string | null) {
  const values = [box?.trim(), floor?.trim() ? `Floor ${floor.trim()}` : ""]
    .filter(Boolean);
  return values.join(" · ");
}

export async function GET() {
  try {
    // Every return is exported: read page by page past the 1,000-row cap.
    const data = await readAllPages((from, to) =>
      supabase
        .from("return_records")
        .select(`
          id,
          created_at,
          actor,
          return_ref,
          customer,
          sur_id,
          courier,
          country_code,
          return_status,
          return_reason,
          imei,
          device_id,
          reported_device,
          previous_box,
          previous_floor,
          target_box,
          target_floor,
          stock_action
        `)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .then(rowsOrThrow)
    );

    const bins = await readInChunks(
      data.map((record) => record.device_id).filter(Boolean),
      (ids) =>
        supabase.from("bins").select("id,name").in("id", ids).then(rowsOrThrow)
    );

    const binMap = Object.fromEntries(
      bins.map((bin) => [String(bin.id), String(bin.name || "")])
    );
    const rows = data.map((record) => ({
      "Return date & time": formatReturnDate(record.created_at),
      "Return reference": record.return_ref,
      "SUR ID": record.sur_id,
      Customer: record.customer,
      Courier: returnCourierLabel(record.courier),
      Country: returnCountryLabel(record.country_code),
      Device:
        String(record.reported_device || "").trim() ||
        binMap[String(record.device_id)] ||
        "",
      IMEI: record.imei,
      Status: returnStatusLabel(record.return_status),
      "Return reason": record.return_reason,
      "Previous location": locationLabel(
        record.previous_box,
        record.previous_floor
      ),
      "Target location": locationLabel(record.target_box, record.target_floor),
      "Stock action": returnStockActionLabel(record.stock_action),
      "Processed by": record.actor,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 22 },
      { wch: 24 },
      { wch: 24 },
      { wch: 28 },
      { wch: 14 },
      { wch: 24 },
      { wch: 20 },
      { wch: 18 },
      { wch: 26 },
      { wch: 34 },
      { wch: 30 },
      { wch: 30 },
      { wch: 22 },
      { wch: 32 },
    ];
    if (worksheet["!ref"]) {
      worksheet["!autofilter"] = { ref: worksheet["!ref"] };
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Returns Export");
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          "attachment; filename=stockpro_returns_export.xlsx",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Returns export failed" },
      { status: 500 }
    );
  }
}
