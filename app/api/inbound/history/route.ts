import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const url = new URL(req.url);
    const deviceQ = (url.searchParams.get("device") || "").trim();
    const from = (url.searchParams.get("from") || "").trim(); // YYYY-MM-DD
    const to = (url.searchParams.get("to") || "").trim(); // YYYY-MM-DD

    const supabase = authedClient(token);

    // If a device filter is provided, we first resolve which import_id's match.
    let importIdFilter: string[] | null = null;
    if (deviceQ) {
      const { data: matches, error: mErr } = await supabase
        .from("inbound_import_boxes")
        .select("import_id")
        .ilike("device", `%${deviceQ}%`)
        .limit(5000);

      if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

      importIdFilter = Array.from(new Set((matches ?? []).map((x: any) => String(x.import_id))));
      if (importIdFilter.length === 0) {
        return NextResponse.json({ ok: true, imports: [] });
      }
    }

    let q = supabase
      .from("inbound_imports")
      .select("import_id, created_at, created_by, file_name, devices_count, boxes_count, items_count")
      .order("created_at", { ascending: false })
      .limit(100);

    if (importIdFilter) q = q.in("import_id", importIdFilter);

    if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`);
    if (to) q = q.lte("created_at", `${to}T23:59:59.999Z`);

    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const imports = (data ?? []) as any[];

    // Attach a derived list of devices per import (for display)
    const ids = imports.map((r) => String(r.import_id));
    const devicesByImport = new Map<string, Set<string>>();
    if (ids.length > 0) {
      const { data: boxRows, error: bErr } = await supabase
        .from("inbound_import_boxes")
        .select("import_id, device")
        .in("import_id", ids)
        .limit(20000);

      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });

      for (const r of boxRows ?? []) {
        const id = String((r as any).import_id);
        const dev = String((r as any).device || "").trim();
        if (!dev) continue;
        const set = devicesByImport.get(id) ?? new Set<string>();
        set.add(dev);
        devicesByImport.set(id, set);
      }
    }

    const out = imports.map((r) => ({
      ...r,
      devices: Array.from(devicesByImport.get(String(r.import_id)) ?? []),
    }));

    // Attach a friendly creator name (first part of email) when possible.
    const creatorIds = Array.from(new Set(out.map((r: any) => String(r.created_by || "")).filter(Boolean)));
    const emailByUser = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, email")
        .in("user_id", creatorIds);

      if (!pErr) {
        for (const p of profiles ?? []) {
          const id = String((p as any).user_id);
          const email = String((p as any).email || "").trim();
          if (id && email) emailByUser.set(id, email);
        }
      }
    }

    const outWithCreator = out.map((r: any) => {
      const id = String(r.created_by || "");
      const email = emailByUser.get(id) || "";
      const name = email ? email.split("@")[0] : "";
      return {
        ...r,
        created_by_email: email || null,
        created_by_name: name || null,
      };
    });

    return NextResponse.json({ ok: true, imports: outWithCreator });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
