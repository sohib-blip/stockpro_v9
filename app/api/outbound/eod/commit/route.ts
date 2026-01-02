import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const BodySchema = z.object({
  imeis: z.array(z.string().min(14)).min(1),
  clear_location_when_empty: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    const body = BodySchema.parse(await req.json());

    const imeis = Array.from(
      new Set(body.imeis.map((x) => String(x || "").trim()).filter(Boolean))
    );

    // 1) Load items
    const { data: rows, error: selErr } = await admin
      .from("items")
      .select("imei, box_id, status")
      .in("imei", imeis);

    if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 400 });

    const found = rows || [];
    const foundSet = new Set(found.map((r: any) => r.imei));

    const not_found = imeis.filter((i) => !foundSet.has(i));
    const already_out = found
      .filter((r: any) => String(r.status).toUpperCase() === "OUT")
      .map((r: any) => r.imei);

    const to_out = found
      .filter((r: any) => String(r.status).toUpperCase() === "IN")
      .map((r: any) => r.imei);

    // 2) Update items IN -> OUT
    if (to_out.length > 0) {
      const { error: upErr } = await admin
        .from("items")
        .update({ status: "OUT", updated_at: new Date().toISOString() })
        .in("imei", to_out);

      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });
    }

    // 3) Check impacted boxes and mark empty boxes as OUT (+ optional location null)
    const affectedBoxIds = Array.from(new Set(found.map((r: any) => r.box_id).filter(Boolean)));

    const emptied_boxes: string[] = [];

    for (const boxId of affectedBoxIds) {
      const { count, error: cntErr } = await admin
        .from("items")
        .select("item_id", { count: "exact", head: true })
        .eq("box_id", boxId)
        .eq("status", "IN");

      if (cntErr) return NextResponse.json({ ok: false, error: cntErr.message }, { status: 400 });

      if ((count || 0) === 0) {
        const updateBox: any = { status: "OUT", updated_at: new Date().toISOString() };
        if (body.clear_location_when_empty) updateBox.location = null;

        const { error: boxErr } = await admin.from("boxes").update(updateBox).eq("box_id", boxId);
        if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 400 });

        emptied_boxes.push(boxId);
      }
    }

    return NextResponse.json({
      ok: true,
      total_imeis_in_file: imeis.length,
      found: found.length,
      removed_from_stock: to_out.length,
      already_out: already_out.length,
      not_found: not_found.length,
      emptied_boxes: emptied_boxes.length,
      clear_location_when_empty: body.clear_location_when_empty,
      lists: {
        not_found: not_found.slice(0, 200),
        already_out: already_out.slice(0, 200),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
