import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("movements")
      .select(`
        operation_id,
        created_at,
        actor,
        shipment_ref,
        return_type,
        return_reason,
        imei,
        box_id,
        device_id,
        items (
          status
        )
      `)
      .eq("type", "RETURN")
      .order("created_at", { ascending: false })
      .limit(50000);

    if (error) throw error;

    const boxIds = Array.from(new Set((data || []).map((m: any) => m.box_id).filter(Boolean)));
    const deviceIds = Array.from(new Set((data || []).map((m: any) => m.device_id).filter(Boolean)));

    const [{ data: boxes }, { data: bins }] = await Promise.all([
      supabase
        .from("boxes")
        .select("id, box_code, floor")
        .in("id", boxIds.length ? boxIds : ["00000000-0000-0000-0000-000000000000"]),

      supabase
        .from("bins")
        .select("id, name")
        .in("id", deviceIds.length ? deviceIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);

    const boxMap = Object.fromEntries((boxes || []).map((b: any) => [b.id, b]));
    const binMap = Object.fromEntries((bins || []).map((b: any) => [b.id, b]));

    const rows = (data || []).map((m: any) => {
      const currentStatus = String(m.items?.status || "");
      const available = currentStatus.toUpperCase() === "IN" ? "Available" : "Already out again";

      return {
        "Date / Time": new Date(m.created_at).toLocaleString(),
        User: m.actor || "",
        "Return Type": m.return_type || "",
        Reason: m.return_reason || "",
        "Return Ref": m.shipment_ref || "",
        Device: binMap[m.device_id]?.name || "",
        IMEI: m.imei || "",
        "Current Box": boxMap[m.box_id]?.box_code || "",
        "Current Floor": boxMap[m.box_id]?.floor || "",
        "Current Status": currentStatus,
        Availability: available,
        "Operation ID": m.operation_id || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 22 },
      { wch: 28 },
      { wch: 20 },
      { wch: 34 },
      { wch: 22 },
      { wch: 20 },
      { wch: 24 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 20 },
      { wch: 40 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Returns");

    const buffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx",
    });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=returns_export.xlsx",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Returns export failed" },
      { status: 500 }
    );
  }
}