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
      return NextResponse.json(
        { ok: false, error: "batch_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    // Load batch
    const { data: batch, error: batchErr } = await supabase
      .from("outbound_batches")
      .select("*")
      .eq("batch_id", batch_id)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { ok: false, error: "Batch not found" },
        { status: 404 }
      );
    }

    // Load movements + joins
    const { data: movements, error: movErr } = await supabase
      .from("movements")
      .select(`
        created_at,
        item_id,
        items (
          imei
        ),
        box_id,
        boxes (
          box_code,
          bins (
            name
          )
        )
      `)
      .eq("batch_id", batch_id)
      .eq("type", "OUT");

    if (movErr) {
      return NextResponse.json(
        { ok: false, error: movErr.message },
        { status: 500 }
      );
    }

    if (!movements || movements.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No data for this batch" },
        { status: 404 }
      );
    }

    // Build Excel rows
    const rows = movements.map((m: any) => ({
      "Date / Time": new Date(batch.created_at).toLocaleString(),
      "User": batch.actor || "",
      "Shipment Ref": batch.shipment_ref || "",
      "Source": batch.source || "",
      "Device": m.boxes?.bins?.name || "",
      "Box ID": m.boxes?.box_code || "",
      "IMEI": m.items?.imei || "",
      "Batch ID": batch.batch_id,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Outbound");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=outbound_${batch_id}.xlsx`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Export failed" },
      { status: 500 }
    );
  }
}