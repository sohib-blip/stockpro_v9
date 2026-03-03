import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const supabase = sb();
    const { searchParams } = new URL(req.url);
    const batch_id = searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "Missing batch_id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("movements")
      .select(`
        created_at,
        actor,
        imei,
        box_id,
        boxes (
          box_code,
          floor,
          bins ( name )
        )
      `)
      .eq("type", "IN")
      .eq("batch_id", batch_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const rows = (data || []).map((r: any) => ({
      date_time: r.created_at,
      user: r.actor || "",
      device: r.boxes?.bins?.name || "",
      box_code: r.boxes?.box_code || "",
      floor: r.boxes?.floor || "",
      imei: r.imei || "", // ✅ vient de movements
    }));

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
    return NextResponse.json({ ok: false, error: e?.message || "Export failed" }, { status: 500 });
  }
}