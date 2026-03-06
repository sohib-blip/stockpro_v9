import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

async function fetchAllItems(supabase:any) {

  const pageSize = 1000;
  let from = 0;
  let rows:any[] = [];

  while (true) {

    const { data, error } = await supabase
      .from("items")
      .select(`
        imei,
        status,
        boxes (
          box_code,
          floor,
          bins (
            name
          )
        )
      `)
      .range(from, from + pageSize - 1);

    if (error) throw error;

    if (!data || data.length === 0) break;

    rows.push(...data);

    if (data.length < pageSize) break;

    from += pageSize;

  }

  return rows;
}

function csv(v:any) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}

export async function GET(req:Request) {

  try {

    const supabase = sb();
    const { searchParams } = new URL(req.url);

    const format = searchParams.get("format") || "xlsx";

    const data = await fetchAllItems(supabase);

    if (!data.length) {
      return NextResponse.json(
        { ok:false, error:"No stock data" },
        { status:404 }
      );
    }

    const rows = data.map((r:any)=>({

      device: r.boxes?.bins?.name || "",
      box_code: r.boxes?.box_code || "",
      floor: r.boxes?.floor || "",
      imei: r.imei || "",
      status: r.status || ""

    }));

    rows.sort((a,b)=>{

  if(a.device !== b.device)
    return a.device.localeCompare(b.device);

  if(a.box_code !== b.box_code)
    return a.box_code.localeCompare(b.box_code);

  return a.imei.localeCompare(b.imei);

});

    // ⚡ CSV FAST EXPORT
    if (format === "csv") {

      const header = ["device","box_code","floor","imei","status"].join(",");

      const body = rows
        .map(r =>
          [
            csv(r.device),
            csv(r.box_code),
            csv(r.floor),
            csv(r.imei),
            csv(r.status)
          ].join(",")
        )
        .join("\n");

      const csvText = `${header}\n${body}\n`;

      return new NextResponse(csvText,{
        headers:{
          "Content-Type":"text/csv; charset=utf-8",
          "Content-Disposition":`attachment; filename=dashboard_stock_${new Date().toISOString().slice(0,10)}.csv`
        }
      });

    }

    // 📊 EXCEL EXPORT
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dashboard");

    const buffer = XLSX.write(wb,{
      type:"buffer",
      bookType:"xlsx"
    });

    return new NextResponse(buffer,{
      headers:{
        "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":`attachment; filename=dashboard_stock_${new Date().toISOString().slice(0,10)}.xlsx`
      }
    });

  } catch(e:any) {

    return NextResponse.json(
      { ok:false, error:e?.message || "Export failed" },
      { status:500 }
    );

  }
}