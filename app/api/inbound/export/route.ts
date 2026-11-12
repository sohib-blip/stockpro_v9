import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import {
  readAllPages,
  readInChunks,
  rowsOrThrow,
} from "@/lib/supabase/read-all-pages";
import { errorMessage } from "@/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

// created_at is shared by a whole batch, so movement_id keeps the page order
// stable and no row is repeated or skipped between pages.
function fetchAllMovements(supabase: ReturnType<typeof sb>, batch_id: string) {
  return readAllPages((from, to) =>
    supabase
      .from("movements")
      .select("created_at, actor, imei, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id)
      .order("created_at", { ascending: true })
      .order("movement_id", { ascending: true })
      .range(from, to)
      .then(rowsOrThrow)
  );
}

export async function GET(req: Request) {
  try {

    const supabase = sb();
    const { searchParams } = new URL(req.url);
    const batch_id = searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "Missing batch_id" }, { status: 400 });
    }

    // Export all matching rows.
    const movs = await fetchAllMovements(supabase, batch_id);

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No movements found" }, { status: 404 });
    }

    const boxIds = movs.map((m: any) => m.box_id).filter(Boolean).map(String);

    const boxes = await readInChunks(boxIds, (ids) =>
      supabase
        .from("boxes")
        .select("id, box_code, floor, bin_id")
        .in("id", ids)
        .then(rowsOrThrow)
    );

    const boxMap: Record<string, any> = {};
    for (const b of boxes) boxMap[String((b as any).id)] = b;

    const binIds = boxes.map((b: any) => b.bin_id).filter(Boolean).map(String);

    const bins = await readInChunks(binIds, (ids) =>
      supabase.from("bins").select("id, name").in("id", ids).then(rowsOrThrow)
    );

    const binMap: Record<string, string> = {};
    for (const b of bins) binMap[String((b as any).id)] = String((b as any).name);

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

  } catch (e) {

    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Export failed") },
      { status: 500 }
    );

  }
}
