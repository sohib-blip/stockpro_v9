import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  authorizeCapabilityRequest,
  supabaseService,
} from "@/lib/auth";
import {
  acquireWorkloadLease,
  releaseWorkloadLease,
  workloadRejectionResponse,
} from "@/lib/security/workload-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_EXPORT_ROWS = 50_000;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

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

  const admission = await acquireWorkloadLease(req, "dashboardExport", {
    principal: authorization.user.id,
  });
  if (!admission.ok) return workloadRejectionResponse(admission);

  try {
    const supabase = supabaseService();
    let allRows: any[] = [];
    const pageSize = 1000;
    const requestedRows = MAX_EXPORT_ROWS + 1;

    while (allRows.length < requestedRows) {
      const from = allRows.length;
      const to =
        from + Math.min(pageSize, requestedRows - allRows.length) - 1;

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

      if (data.length < to - from + 1) break;
    }

    if (allRows.length > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Stock export exceeds the ${MAX_EXPORT_ROWS}-row synchronous limit.`,
        },
        { status: 413 }
      );
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

    if (buffer.length > MAX_EXPORT_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Generated stock export is too large." },
        { status: 413 }
      );
    }

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
  } finally {
    await releaseWorkloadLease(admission.leaseId);
  }
}
