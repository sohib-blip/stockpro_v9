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

    const supabase = sb();

    const { data } = await supabase
      .from("movements")
      .select(`
        created_at,
        actor,
        items (
          imei,
          boxes (
            box_code,
            bins ( name )
          )
        )
      `)
      .eq("batch_id", batch_id)
      .eq("type", "OUT");

    const rows =
      data?.map((r: any) => ({
        date: r.created_at,
        actor: r.actor,
        device: r.items?.boxes?.bins?.name,
        box: r.items?.boxes?.box_code,
        imei: r.items?.imei,
      })) || [];

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Outbound");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=outbound_${batch_id}.xlsx`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}