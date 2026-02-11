import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

/* =========================
   Supabase helpers
========================= */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
}

/* =========================
   Types
========================= */
type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

/* =========================
   POST /api/inbound/preview
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const userClient = authedClient(token);
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    /* ---------- FormData ---------- */
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = form.get("vendor") as Vendor | null;
    const format = String(form.get("format") || "");
    const location = String(form.get("location") || "").trim() || "00";

    if (!file || !vendor) {
      return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });
    }

    /* ---------- Read Excel as bytes ---------- */
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) {
      return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });
    }

    /* ---------- Load devices DB ---------- */
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });
    }

    const { data: devicesDbRows, error: devErr } = await admin
      .from("devices")
      .select("canonical_name, device, active");

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    const devicesDb = toDeviceMatchList(devicesDbRows || []);

    /* ---------- Parse ---------- */
    const parsed = parseVendorExcel(vendor, bytes, devicesDb);

    if (!parsed.ok) {
      return NextResponse.json(parsed, { status: 400 });
    }

    /* ---------- Return ---------- */
    return NextResponse.json({
      ok: true,
      vendor,
      format,
      location,
      labels: parsed.labels.map((l) => ({
        device: l.device,
        box_no: l.box_no,
        qty: l.qty,
        qr_data: l.qr_data,
      })),
      counts: parsed.counts,
      debug: parsed.debug ?? null,
    });
  } catch (e: any) {
    console.error("Inbound preview error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}