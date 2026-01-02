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

    const { data: rows, error } = await admin
      .from("items")
      .select("imei, box_id, status")
      .in("imei", imeis);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    const found = rows || [];
    const foundSet = new Set(found.map((r: any) => r.imei));

    const not_found = imeis.filter((i) => !foundSet.has(i));
    const already_out = found
      .filter((r: any) => String(r.status).toUpperCase() === "OUT")
      .map((r: any) => r.imei);

    const to_out = found.filter((r: any) => String(r.status).toUpperCase() === "IN");

    const affectedBoxIds = Array.from(new Set(to_out.map((r: any) => r.box_id).filter(Boolean)));

    const perBoxRemoveCount: Record<string, number> = {};
    for (const r of to_out) perBoxRemoveCount[r.box_id] = (perBoxRemoveCount[r.box_id] || 0) + 1;

    const boxes_will_be_emptied: string[] = [];
    const boxes: any[] = [];

    if (affectedBoxIds.length) {
      const { data: b, error: bErr } = await admin
        .from("boxes")
        .select("box_id, box_no, master_box_no, device, location, status")
        .in("box_id", affectedBoxIds);

      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 400 });

      const boxMap = new Map((b || []).map((x: any) => [x.box_id, x]));

      for (const boxId of affectedBoxIds) {
        const { count, error: cntErr } = await admin
          .from("items")
          .select("item_id", { count: "exact", head: true })
          .eq("box_id", boxId)
          .eq("status", "IN");

        if (cntErr) return NextResponse.json({ ok: false, error: cntErr.message }, { status: 400 });

        const currentIn = count || 0;
        const will_remove = perBoxRemoveCount[boxId] || 0;
        const will_remain = Math.max(0, currentIn - will_remove);
        const will_be_emptied = will_remain === 0;

        if (will_be_emptied) boxes_will_be_emptied.push(boxId);

        const meta = boxMap.get(boxId) || {};
        boxes.push({
          box_id: boxId,
          device: meta.device ?? null,
          master_box_no: meta.master_box_no ?? null,
          box_no: meta.box_no ?? null,
          location: meta.location ?? null,
          current_in: currentIn,
          will_remove,
          will_remain,
          will_be_emptied,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      total_imeis_in_file: imeis.length,
      found: found.length,
      will_remove_from_stock: to_out.length,
      already_out: already_out.length,
      not_found: not_found.length,
      affected_boxes: affectedBoxIds.length,
      boxes_will_be_emptied: boxes_will_be_emptied.length,
      clear_location_when_empty: body.clear_location_when_empty,
      lists: {
        not_found: not_found.slice(0, 200),
        already_out: already_out.slice(0, 200),
      },
      boxes,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
