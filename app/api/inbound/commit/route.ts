import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// parsers (nouvelle archi)
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

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
    const vendor = (form.get("vendor") as Vendor | null) ?? null;
    const location = String(form.get("location") || "").trim() || "00";

    if (!file || !vendor) {
      return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });
    }

    /* ---------- Read Excel (bytes) ---------- */
    const bytes = new Uint8Array(await file.arrayBuffer());

    /* ---------- Admin + devices list ---------- */
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

    /* ---------- Parse (NEW SIGNATURE) ---------- */
    const parsed = parseVendorExcel(vendor, bytes, devicesDb);

    if (!parsed.ok) {
      return NextResponse.json(parsed, { status: 400 });
    }

    const labels = parsed.labels;

    /* ---------- Import DB (boxes + items) ---------- */
    // ⚠️ assumes tables:
    // boxes: { box_id, device, box_no, location, status }
    // items: { box_id, imei, status }
    // If your schema differs -> tell me and I adjust in 2 sec.
    const imported: Array<{ device: string; box_no: string; qty: number; box_id?: string | null }> = [];

    for (const l of labels) {
      // 1) create box (or reuse if exists)
      let boxId: string | null = null;

      // try insert first
      const { data: boxRow, error: boxErr } = await admin
        .from("boxes")
        .insert({
          device: l.device,
          box_no: l.box_no,
          location,
          status: "IN_STOCK",
        })
        .select("box_id")
        .maybeSingle();

      if (boxErr) {
        // if duplicate (box already exists) => fetch existing
        const { data: existing, error: fetchErr } = await admin
          .from("boxes")
          .select("box_id")
          .eq("device", l.device)
          .eq("box_no", l.box_no)
          .maybeSingle();

        if (fetchErr || !existing?.box_id) {
          return NextResponse.json(
            { ok: false, error: `Failed to create/fetch box ${l.device} ${l.box_no}: ${boxErr.message}` },
            { status: 500 }
          );
        }
        boxId = existing.box_id;
      } else {
        boxId = boxRow?.box_id ?? null;
      }

      // 2) insert items
      if (boxId) {
        const rowsToInsert = (l.imeis || []).map((imei) => ({
          box_id: boxId,
          imei,
          status: "IN_STOCK",
        }));

        if (rowsToInsert.length > 0) {
          const { error: itemsErr } = await admin.from("items").insert(rowsToInsert);
          if (itemsErr) {
            return NextResponse.json(
              { ok: false, error: `Failed inserting IMEIs for ${l.device} ${l.box_no}: ${itemsErr.message}` },
              { status: 500 }
            );
          }
        }
      }

      imported.push({ device: l.device, box_no: l.box_no, qty: l.qty, box_id: boxId });
    }

    /* ---------- Response ---------- */
    return NextResponse.json({
      ok: true,
      vendor,
      location,
      counts: parsed.counts,
      labels: imported.map((x) => ({
        device: x.device,
        box_no: x.box_no,
        qty: x.qty,
      })),
      debug: parsed.debug ?? null,
    });
  } catch (e: any) {
    console.error("Inbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}