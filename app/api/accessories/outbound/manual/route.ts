import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { shipment_ref, comment, actor, actor_id, lines, preview } =
  await req.json();

    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ ok: false, error: "No lines provided" }, { status: 400 });
    }

    const operation_id = crypto.randomUUID();

    const grouped = new Map<string, number>();

    for (const line of lines) {
      if (!line.accessory_id || Number(line.qty) <= 0) continue;

      grouped.set(
        line.accessory_id,
        (grouped.get(line.accessory_id) || 0) + Number(line.qty)
      );
    }

    const ids = Array.from(grouped.keys());

    const { data: accessories, error } = await supabase
      .from("accessory_bins")
      .select("id, name, current_stock")
      .in("id", ids);

    if (error) throw error;

    for (const item of accessories || []) {
      const needed = grouped.get(item.id) || 0;

      if (Number(item.current_stock || 0) < needed) {
        return NextResponse.json(
          {
            ok: false,
            error: `Not enough stock for ${item.name}. Stock: ${item.current_stock}, needed: ${needed}`,
          },
          { status: 400 }
        );
      }
    }

if (String(preview || "") === "1") {
  return NextResponse.json({
    ok: true,
    preview: true,
    rows: (accessories || []).map((item: any) => {
      const qty = grouped.get(item.id) || 0;

      return {
        accessory_bin_id: item.id,
        accessory: item.name,
        qty,
        current_stock: Number(item.current_stock || 0),
        after_stock: Number(item.current_stock || 0) - qty,
      };
    }),
  });
}

    for (const item of accessories || []) {
      const qty = grouped.get(item.id) || 0;
      const newStock = Number(item.current_stock || 0) - qty;

      const { error: updateError } = await supabase
        .from("accessory_bins")
        .update({ current_stock: newStock })
        .eq("id", item.id);

      if (updateError) throw updateError;

      const { error: moveError } = await supabase
        .from("accessory_movements")
        .insert({
          accessory_bin_id: item.id,
          qty,
          movement_type: "OUT",
          shipment_ref: shipment_ref || null,
          note: comment || null,
          actor: actor || "unknown",
          actor_id: actor_id || null,
          source: "manual",
          operation_id,
        });

      if (moveError) throw moveError;
    }

    return NextResponse.json({ ok: true, operation_id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Manual outbound failed" },
      { status: 500 }
    );
  }
}