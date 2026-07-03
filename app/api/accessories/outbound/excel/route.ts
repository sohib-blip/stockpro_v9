import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function norm(value: any) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();

    const file = form.get("file") as File;
    const shipment_ref = String(form.get("shipment_ref") || "");
    const comment = String(form.get("comment") || "");
    const actor = String(form.get("actor") || "unknown");
    const actor_id = String(form.get("actor_id") || "");

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", raw: false });

    const grouped = new Map<string, number>();

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];

      const rows = XLSX.utils.sheet_to_json<any>(sheet, {
        raw: false,
        defval: "",
      });

      for (const row of rows) {
        const keys = Object.keys(row);

        const accessoryKey = keys.find((k) =>
          ["accessory", "accessories", "item", "items", "name"].includes(norm(k))
        );

        const qtyKey = keys.find((k) =>
          ["qty", "quantity", "amount"].includes(norm(k))
        );

        if (!accessoryKey) continue;

        const accessoryName = String(row[accessoryKey] || "").trim();
        const qty = qtyKey ? Number(row[qtyKey] || 0) : 1;

        if (!accessoryName || qty <= 0) continue;

        grouped.set(
          norm(accessoryName),
          (grouped.get(norm(accessoryName)) || 0) + qty
        );
      }
    }

    if (grouped.size === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid accessories found in Excel. Expected columns: Accessory, Qty." },
        { status: 400 }
      );
    }

    const { data: accessories, error } = await supabase
      .from("accessory_bins")
      .select("id, name, current_stock")
      .eq("active", true);

    if (error) throw error;

    const accessoryMap = new Map(
      (accessories || []).map((a: any) => [norm(a.name), a])
    );

    const matched: any[] = [];
    const unknown: string[] = [];

    for (const [name, qty] of grouped.entries()) {
      const item = accessoryMap.get(name);

      if (!item) {
        unknown.push(name);
        continue;
      }

      matched.push({ item, qty });
    }

    if (unknown.length > 0) {
      return NextResponse.json(
        { ok: false, error: `Unknown accessories: ${unknown.join(", ")}` },
        { status: 400 }
      );
    }

    for (const row of matched) {
      if (Number(row.item.current_stock || 0) < row.qty) {
        return NextResponse.json(
          {
            ok: false,
            error: `Not enough stock for ${row.item.name}. Stock: ${row.item.current_stock}, needed: ${row.qty}`,
          },
          { status: 400 }
        );
      }
    }

    const operation_id = crypto.randomUUID();

    for (const row of matched) {
      const newStock = Number(row.item.current_stock || 0) - row.qty;

      const { error: updateError } = await supabase
        .from("accessory_bins")
        .update({ current_stock: newStock })
        .eq("id", row.item.id);

      if (updateError) throw updateError;

      const { error: moveError } = await supabase
        .from("accessory_movements")
        .insert({
          accessory_bin_id: row.item.id,
          qty: row.qty,
          movement_type: "OUT",
          shipment_ref: shipment_ref || null,
          comment: comment || null,
          actor,
          actor_id: actor_id || null,
          source: "excel",
          operation_id,
        });

      if (moveError) throw moveError;
    }

    return NextResponse.json({ ok: true, operation_id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Excel outbound failed" },
      { status: 500 }
    );
  }
}