import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    const supabase = sb();

    const { data: rows, error } = await supabase
      .from("movements")
      .select(`
        created_at,
        actor,
        batch_id,
        items ( imei ),
        boxes ( box_code, bin_id ),
        boxes:boxes (
          box_code,
          bins ( name )
        )
      `)
      .eq("batch_id", batch_id)
      .eq("type", "IN");

    if (error) throw error;

    const formatted = (rows || []).map((r: any) => ({
      Date: r.created_at,
      Actor: r.actor,
      Batch: r.batch_id,
      Device: r.boxes?.bins?.name || "",
      Box: r.boxes?.box_code || "",
      IMEI: r.items?.imei || "",
    }));

    const ws = XLSX.utils.json_to_sheet(formatted);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inbound");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=inbound_${batch_id}.xlsx`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}