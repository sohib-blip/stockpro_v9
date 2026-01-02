import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseBoxFromQr(raw: string) {
  const cleaned = (raw || "").trim();

  // 1) BOXID: uuid
  const m1 = cleaned.match(/BOXID\s*:\s*([0-9a-f-]{36})/i);
  if (m1 && isUuid(m1[1])) {
    return { box_id: m1[1], box_code: "", master: "" };
  }

  // 2) key/value style: BOX:xxx|DEV:yyy|MASTER:zzz
  const parts = cleaned.split("|");
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx > -1) {
      const k = p.slice(0, idx).trim().toUpperCase();
      const v = p.slice(idx + 1).trim();
      map[k] = v;
    }
  }

  const box_code = map["BOX"] || "";
  const master = map["MASTER"] || "";

  // 3) fallback: if there is any uuid in the string
  const m2 = cleaned.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (m2 && isUuid(m2[0])) {
    return { box_id: m2[0], box_code: "", master: "" };
  }

  return { box_id: "", box_code, master };
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

    const parsed = parseBoxFromQr(body.qr);

    // Find box
    let boxRow: any = null;

    if (parsed.box_id) {
      const r = await admin
        .from("boxes")
        .select("box_id, box_no, master_box_no, device, location, status")
        .eq("box_id", parsed.box_id)
        .maybeSingle();
      if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 400 });
      boxRow = r.data;
    } else {
      const candidates = [parsed.master, parsed.box_code].filter(Boolean);
      if (candidates.length === 0) {
        return NextResponse.json({ ok: false, error: "Could not parse box from QR" }, { status: 400 });
      }

      // Try match on master_box_no or box_no
      const r = await admin
        .from("boxes")
        .select("box_id, box_no, master_box_no, device, location, status")
        .or(candidates.map((c) => `master_box_no.eq.${c},box_no.eq.${c}`).join(","))
        .limit(1)
        .maybeSingle();

      if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 400 });
      boxRow = r.data;
    }

    if (!boxRow) return NextResponse.json({ ok: false, error: "Box not found" }, { status: 404 });

    const fromLoc = boxRow.location || null;
    const toLoc = body.to_location;

    // Update box location
    const up = await admin
      .from("boxes")
      .update({ location: toLoc, updated_at: new Date().toISOString() })
      .eq("box_id", boxRow.box_id);
    if (up.error) return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });

    // Insert movement log (minimal columns to avoid schema mismatch)
    const ins = await admin.from("box_movements").insert({
      box_id: boxRow.box_id,
      from_location: fromLoc,
      to_location: toLoc,
      note: body.note || null,
      created_by: userId,
      created_by_email: userEmail,
    });

    if (ins.error) {
      // if your table uses different column names, tell me and I’ll adapt.
      return NextResponse.json({ ok: false, error: ins.error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      box: {
        box_id: boxRow.box_id,
        box_no: boxRow.box_no,
        master_box_no: boxRow.master_box_no,
        device: boxRow.device,
        status: boxRow.status,
        from_location: fromLoc,
        to_location: toLoc,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
