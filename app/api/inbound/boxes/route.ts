import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const import_id = url.searchParams.get("import_id");

    if (!import_id) {
      return NextResponse.json({ ok: false, error: "Missing import_id" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const supabase = authedClient(token);

    // Fetch boxes for this import + device name
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device_id, devices(canonical_name)")
      .eq("import_id", import_id)
      .order("box_no", { ascending: true });

    if (boxErr) {
      return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    }

    // For qty per box, we aggregate by box_id
    const boxIds = (boxes ?? []).map((b: any) => b.box_id);

    let qtyMap = new Map<string, number>();
    if (boxIds.length > 0) {
      // Supabase doesn't do groupBy easily in JS client, so we do a simple fetch then count
      const { data: items, error: itemsErr } = await supabase
        .from("items")
        .select("box_id")
        .in("box_id", boxIds);

      if (itemsErr) {
        return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });
      }

      qtyMap = new Map<string, number>();
      for (const it of items ?? []) {
        const id = (it as any).box_id as string;
        qtyMap.set(id, (qtyMap.get(id) ?? 0) + 1);
      }
    }

    const rows = (boxes ?? []).map((b: any) => ({
      box_id: b.box_id,
      box_no: b.box_no,
      device: b.devices?.canonical_name ?? "",
      qty: qtyMap.get(b.box_id) ?? 0,
    }));

    return NextResponse.json({ ok: true, import_id, boxes: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
