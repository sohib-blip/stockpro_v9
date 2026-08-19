import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { supabaseService } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeCell(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function GET(req: Request) {
  try {
    const parsed = z.string().uuid().safeParse(
      new URL(req.url).searchParams.get("id")
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid dispatch batch." },
        { status: 400 }
      );
    }

    const { data: batch, error } = await supabaseService()
      .from("dispatch_batches")
      .select("*")
      .eq("id", parsed.data)
      .maybeSingle();
    if (error) throw error;
    if (!batch) {
      return NextResponse.json(
        { ok: false, error: "Dispatch batch not found." },
        { status: 404 }
      );
    }

    const orders = Array.isArray(batch.orders) ? batch.orders : [];
    const rows = orders.flatMap((order: any) =>
      (Array.isArray(order.items) ? order.items : []).map((item: any) => ({
        "Order ID": safeCell(order.orderId),
        Country: safeCell(order.destinationCountry),
        Customer: safeCell(order.companyName),
        "Source item": safeCell(item.sourceItem),
        "Mapped item": safeCell(item.name),
        Quantity: Number(item.quantity || 0),
        "Unit volume (cm3)": Number(item.unitVolumeCm3 || 0),
        "Total volume (cm3)": Number(item.totalVolumeCm3 || 0),
        Packaging: safeCell(
          (order.packages || [])
            .map((packaging: any) => `${packaging.quantity} × ${packaging.name}`)
            .join(", ")
        ),
        Status: safeCell(batch.status),
        "Confirmed at": safeCell(batch.confirmed_at),
      }))
    );
    const summaryRows = (batch.package_usage || []).map((usage: any) => ({
      Code: safeCell(usage.code),
      Packaging: safeCell(usage.name),
      "Quantity deducted": Number(usage.quantity || 0),
      "Stock before": Number(usage.onHandStock || 0),
      "Stock after": Number(usage.stockAfter || 0),
      Status: safeCell(batch.status),
    }));

    const workbook = XLSX.utils.book_new();
    const ordersSheet = XLSX.utils.json_to_sheet(rows);
    ordersSheet["!cols"] = [
      { wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 30 }, { wch: 28 },
      { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 32 }, { wch: 14 }, { wch: 22 },
    ];
    const packagesSheet = XLSX.utils.json_to_sheet(summaryRows);
    packagesSheet["!cols"] = [
      { wch: 16 }, { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(workbook, ordersSheet, "Orders");
    XLSX.utils.book_append_sheet(workbook, packagesSheet, "Packaging Summary");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const filename = `dispatch-${String(batch.source_filename)
      .replace(/\.xlsx?$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("DISPATCH EXPORT ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Dispatch batch export failed." },
      { status: 500 }
    );
  }
}
