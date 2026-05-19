import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const operationId = url.searchParams.get("operation_id");

    if (!operationId) {
      return NextResponse.json(
        { ok: false, error: "operation_id required" },
        { status: 400 }
      );
    }

    const supabase = sb();

    const { data: movements, error } = await supabase
      .from("movements")
      .select(`
        created_at,
        actor,
        shipment_ref,
        source,
        operation_id,
        imei,
        box_id,
        device_id
      `)
      .eq("operation_id", operationId)
      .eq("type", "OUT")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!movements || movements.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No data for this operation" },
        { status: 404 }
      );
    }

    const boxIds = [
      ...new Set(movements.map((m: any) => m.box_id).filter(Boolean)),
    ];

    const deviceIds = [
      ...new Set(movements.map((m: any) => m.device_id).filter(Boolean)),
    ];

    const [{ data: boxes }, { data: devices }] = await Promise.all([
      supabase
        .from("boxes")
        .select("id, box_code, floor")
        .in("id", boxIds.length ? boxIds : ["00000000-0000-0000-0000-000000000000"]),

      supabase
        .from("bins")
        .select("id, name")
        .in("id", deviceIds.length ? deviceIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    const boxMap = Object.fromEntries(
      (boxes || []).map((b: any) => [b.id, b])
    );

    const deviceMap = Object.fromEntries(
      (devices || []).map((d: any) => [d.id, d])
    );

    const rows = movements.map((m: any) => ({
      "Date / Time": new Date(m.created_at).toLocaleString(),
      User: m.actor || "",
      "Shipment Ref": m.shipment_ref || "",
      Source: m.source || "",
      Device: deviceMap[m.device_id]?.name || "",
      "Box ID": boxMap[m.box_id]?.box_code || "",
      Floor: boxMap[m.box_id]?.floor || "",
      IMEI: m.imei || "",
      "Operation ID": m.operation_id || "",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);

    worksheet["!cols"] = [
      { wch: 22 },
      { wch: 28 },
      { wch: 18 },
      { wch: 12 },
      { wch: 20 },
      { wch: 16 },
      { wch: 12 },
      { wch: 24 },
      { wch: 40 },
    ];

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
        "Content-Disposition": `attachment; filename=outbound_${operationId}.xlsx`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Export failed" },
      { status: 500 }
    );
  }
}