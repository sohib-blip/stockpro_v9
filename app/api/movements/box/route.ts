import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function extractImeis(raw: string) {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  const imeis: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const digits = l.replace(/\D/g, "");
    if (/^\d{14,17}$/.test(digits) && !seen.has(digits)) {
      seen.add(digits);
      imeis.push(digits);
    }
  }
  return imeis;
}

const BodySchema = z.object({
  qr: z.string().min(1),
  to_location: z.enum(["00", "1", "6", "Cabinet"]),
  note: z.string().optional().default(""),
});

export async function POST(req: Request) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

    const body = BodySchema.parse(await req.json());

    const authed = authedClient(token);
    const { data: u } = await authed.auth.getUser();
    const userId = u.user?.id || null;
    const userEmail = u.user?.email || null;

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const imeis = extractImeis(body.qr);
    if (imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "Invalid scan. Expected IMEI list (one per line)." }, { status: 400 });
    }

    // find items -> box_ids
    const { data: items, error: itErr } = await admin
      .from("items")
      .select("imei, box_id")
      .in("imei", imeis);

    if (itErr) return NextResponse.json({ ok: false, error: itErr.message }, { status: 500 });

    const boxIds = Array.from(new Set((items || []).map((x: any) => String(x.box_id)).filter(Boolean)));
    if (boxIds.length === 0) {
      return NextResponse.json({ ok: false, error: "No boxes found for these IMEIs" }, { status: 404 });
    }

    // fetch boxes meta
    const { data: boxes, error: bxErr } = await admin
      .from("boxes")
      .select("box_id, box_no, master_box_no, device, location, status")
      .in("box_id", boxIds);

    if (bxErr) return NextResponse.json({ ok: false, error: bxErr.message }, { status: 500 });

    const toLoc = body.to_location;

    // update + log
    const moved: any[] = [];
    for (const b of boxes || []) {
      const fromLoc = (b as any).location ?? null;

      const up = await admin
        .from("boxes")
        .update({ location: toLoc, updated_at: new Date().toISOString() })
        .eq("box_id", (b as any).box_id);

      if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });

      const ins = await admin.from("box_movements").insert({
        box_id: (b as any).box_id,
        from_location: fromLoc,
        to_location: toLoc,
        note: body.note || null,
        created_by: userId,
        created_by_email: userEmail,
      });

      if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 400 });

      moved.push({
        box_id: (b as any).box_id,
        device: (b as any).device,
        box_no: (b as any).box_no,
        master_box_no: (b as any).master_box_no,
        from_location: fromLoc,
        to_location: toLoc,
      });
    }

    return NextResponse.json({
      ok: true,
      imeis_scanned: imeis.length,
      boxes_moved: moved.length,
      moved,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}