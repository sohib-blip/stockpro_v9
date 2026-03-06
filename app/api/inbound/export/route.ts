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

async function fetchAllMovements(supabase: any, batch_id: string) {

  const pageSize = 5000;
  let from = 0;
  let allRows:any[] = [];

  while (true) {

    const { data, error } = await supabase
      .from("movements")
      .select("created_at, actor, imei, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    if (!data || data.length === 0) break;

    allRows.push(...data);

    if (data.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

export async function GET(req: Request) {
  try {

    const supabase = sb();
    const { searchParams } = new URL(req.url);
    const batch_id = searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "Missing batch_id" }, { status: 400 });
    }

    // 🔥 now unlimited
    const movs = await fetchAllMovements(supabase, batch_id);

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No movements found" }, { status: 404 });
    }

    const boxIds = Array.from(new Set(movs.map((m: any) => String(m.box_id)).filter(Boolean)));

    const { data: boxes } = await supabase
      .from("boxes")
      .select("id, box_code, floor, bin_id")
      .in("id", boxIds);

    const boxMap: Record<string, any> = {};
    for (const b of boxes || []) boxMap[String((b as any).id)] = b;

    const binIds = Array.from(
      new Set((boxes || []).map((b: any) => String(b.bin_id)).filter(Boolean))
    );

    const { data: bins } = await supabase
      .from("bins")
      .select("id, name")
      .in("id", binIds);

    const binMap: Record<string, string> = {};
    for (const b of bins || []) binMap[String((b as any).id)] = String((b as any).name);

    const rows = movs.map((m: any) => {

      const bx = boxMap[String(m.box_id)];
      const deviceName = bx?.bin_id ? (binMap[String(bx.bin_id)] || "") : "";

      return {
        date_time: m.created_at,
        user: m.actor || "",
        vendor: "",
        device: deviceName,
        box_code: bx?.box_code || "",
        floor: bx?.floor || "",
        imei: m.imei || "",
      };

    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inbound");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Disposition": `attachment; filename=inbound_${batch_id}.xlsx`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });

  } catch (e: any) {

    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );

  }
}