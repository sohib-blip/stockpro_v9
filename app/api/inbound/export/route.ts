import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const batch_id = url.searchParams.get("batch_id");

    if (!batch_id) {
      return NextResponse.json({ ok: false, error: "batch_id required" }, { status: 400 });
    }

    const supabase = sb();

    // movements
    const { data: movs } = await supabase
      .from("movements")
      .select("item_id, box_id")
      .eq("type", "IN")
      .eq("batch_id", batch_id);

    if (!movs || movs.length === 0) {
      return NextResponse.json({ ok: false, error: "No movements found" }, { status: 404 });
    }

    const itemIds = movs.map((m: any) => m.item_id);

    // items
    const { data: items } = await supabase
      .from("items")
      .select("item_id, imei, device_id, import_id, imported_at")
      .in("item_id", itemIds);

    const header = [
      "batch_id",
      "device_id",
      "box_id",
      "imei",
      "imported_at",
    ];

    const lines: string[] = [];
    lines.push(header.map(csvEscape).join(","));

    for (const m of movs as any[]) {
      const it = items?.find((i: any) => i.item_id === m.item_id);

      lines.push(
        [
          batch_id,
          it?.device_id || "",
          m.box_id || "",
          it?.imei || "",
          it?.imported_at || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }

    const csv = lines.join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="inbound_${batch_id}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Export failed" },
      { status: 500 }
    );
  }
}