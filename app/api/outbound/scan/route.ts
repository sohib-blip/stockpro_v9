import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
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

async function ensureProfileEmail(supabase: any, user: any) {
  try {
    const user_id = String(user?.id || "");
    const email = String(user?.email || "").trim();
    if (!user_id || !email) return;
    await supabase.from("profiles").upsert({ user_id, email }, { onConflict: "user_id" });
  } catch {
    // ignore
  }
}

async function writeAudit(writer: any, row: any) {
  // Some installs use audit_events, others use audit_log.
  const r1 = await writer.from("audit_events").insert(row);
  if (!r1.error) return;
  await writer.from("audit_log").insert(row);
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function parseQrPayload(raw: string) {
  // Supported formats:
  // - QR (new): BOX:...|DEV:...|MASTER:...|QTY:...
  // - Old QR:   BOX:...|DEV:...|IMEI:a,b,c
  const cleaned = raw.trim();

  const parts = cleaned.split("|");
  const map: Record<string, string> = {};
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx > -1) {
      const k = p.slice(0, idx).trim();
      const v = p.slice(idx + 1).trim();
      map[k] = v;
    }
  }

  const box_no = map["BOX"] || "";
  const device = map["DEV"] || "";
  const imeiStr = map["IMEI"] || "";
  const imeis = imeiStr ? imeiStr.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const master_box_no = map["MASTER"] || "";

  return { box_no, device, master_box_no, imeis };
}

function isLikelyImei(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return /^\d{14,17}$/.test(digits);
}

function normalizeImei(raw: string) {
  return raw.replace(/\D/g, "");
}

function extractImeis(raw: string) {
  const matches = String(raw || "").match(/\d{14,17}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const n = normalizeImei(m);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);
    const admin = adminClient();

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: userErr.message }, { status: 401 });
    const user = userData.user;
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    // Ensure profiles.email is available for history displays.
    await ensureProfileEmail(supabase, user);

    // Use admin client for audit writes if available (avoids RLS blocking history).
    // (Already declared above.)

    const body = await req.json().catch(() => ({}));
    const raw = String((body?.raw ?? body?.qr) ?? "").trim();
    if (!raw) return NextResponse.json({ ok: false, error: "Missing scan content" }, { status: 400 });

    // Mode 0: bulk manual list (multiple IMEI pasted)
    const imeiList = extractImeis(raw);
    if (imeiList.length > 1) {
      // Fetch existing items
      const { data: items, error: itemsErr } = await supabase
        .from("items")
        .select("imei,status,box_id")
        .in("imei", imeiList);
      if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 500 });

      const found = new Map<string, any>();
      for (const r of items ?? []) found.set(String((r as any).imei), r);

      const notFound = imeiList.filter((i) => !found.has(i));
      const alreadyOut: string[] = [];
      const toOut: string[] = [];
      const boxIds = new Set<string>();

      for (const i of imeiList) {
        const row = found.get(i);
        if (!row) continue;
        const st = String((row as any).status || "").toUpperCase();
        const box_id = String((row as any).box_id || "");
        if (box_id) boxIds.add(box_id);
        if (st === "OUT") alreadyOut.push(i);
        else toOut.push(i);
      }

      let items_out = 0;
      if (toOut.length) {
        const { error: updErr } = await supabase
          .from("items")
          .update({ status: "OUT" })
          .in("imei", toOut)
          .eq("status", "IN");
        if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
        items_out = toOut.length;
      }

      // Load boxes
      const boxIdArr = Array.from(boxIds);
      const boxes: any[] = [];
      if (boxIdArr.length) {
        const { data: boxRows, error: boxErr } = await supabase
          .from("boxes")
          .select("box_id, box_no, device, status")
          .in("box_id", boxIdArr);
        if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
        boxes.push(...(boxRows ?? []));
      }

      // Update box statuses if empty
      const boxSummaries: any[] = [];
      for (const b of boxes) {
        const box_id = String((b as any).box_id || "");
        if (!box_id) continue;
        const remainingIn = await supabase
          .from("items")
          .select("*", { count: "exact", head: true })
          .eq("box_id", box_id)
          .eq("status", "IN");
        if (!remainingIn.error) {
          const nextBoxStatus = (remainingIn.count ?? 0) === 0 ? "OUT" : "IN";
          await supabase.from("boxes").update({ status: nextBoxStatus }).eq("box_id", box_id);
          boxSummaries.push({ box_id, box_no: (b as any).box_no, device: (b as any).device, box_status: nextBoxStatus });
        }
      }

      // Audit (single event)
      try {
        const writer = admin ?? supabase;
        await writeAudit(writer, {
          action: "STOCK_OUT",
          entity: "bulk",
          // Some schemas define entity_id as uuid; keep it null for non-uuid values.
          entity_id: null,
          payload: {
            total: imeiList.length,
            total_out: items_out,
            already_out: alreadyOut.length,
            not_found: notFound.length,
            boxes: boxSummaries,
          },
          created_by: user.id,
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        mode: "bulk",
        total: imeiList.length,
        total_out: items_out,
        already_out: alreadyOut.length,
        not_found: notFound.length,
        boxes: boxSummaries,
      });
    }

    // Mode 1: scanning a single IMEI (barcode)
    if (isLikelyImei(raw)) {
      const imei = normalizeImei(raw);
      const { data: itemRow, error: itemErr } = await supabase
        .from("items")
        .select("imei, status, box_id")
        .eq("imei", imei)
        .maybeSingle();

      if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 500 });
      if (!itemRow) return NextResponse.json({ ok: false, error: "IMEI not found" }, { status: 404 });

      const box_id = String((itemRow as any).box_id || "");
      const alreadyOut = String((itemRow as any).status || "").toUpperCase() === "OUT";

      if (!alreadyOut) {
        const { error: updErr } = await supabase
          .from("items")
          .update({ status: "OUT" })
          .eq("imei", imei)
          .eq("status", "IN");
        if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
      }

      // Fetch box metadata
      const { data: boxRow, error: boxErr } = await supabase
        .from("boxes")
        .select("box_id, box_no, device, status")
        .eq("box_id", box_id)
        .maybeSingle();

      if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });

      // Update box status if empty
      let nextBoxStatus = boxRow?.status ?? "IN";
      if (boxRow) {
        const remainingIn = await supabase
          .from("items")
          .select("*", { count: "exact", head: true })
          .eq("box_id", box_id)
          .eq("status", "IN");
        if (!remainingIn.error) {
          nextBoxStatus = (remainingIn.count ?? 0) === 0 ? "OUT" : "IN";
          await supabase.from("boxes").update({ status: nextBoxStatus }).eq("box_id", box_id);
        }
      }

      // Audit
      try {
        const writer = admin ?? supabase;
        await writeAudit(writer, {
          action: "STOCK_OUT",
          entity: "item",
          entity_id: null,
          payload: {
            imei,
            box_id,
            box_no: (boxRow as any)?.box_no,
            device: (boxRow as any)?.device,
            box_status: nextBoxStatus,
          },
          created_by: user.id,
        });
      } catch {}

      return NextResponse.json({
        ok: true,
        mode: "imei",
        imei,
        box_id,
        box_no: (boxRow as any)?.box_no ?? null,
        device: (boxRow as any)?.device ?? null,
        items_out: alreadyOut ? 0 : 1,
        box_status: nextBoxStatus,
        warning: alreadyOut ? "IMEI was already OUT" : "",
      });
    }

    // Mode 2: scanning a box QR (BOX + DEV). Old QR can also include IMEI list.
    const parsed = parseQrPayload(raw);
    if (!parsed.box_no || !parsed.device) {
      return NextResponse.json({ ok: false, error: "Invalid scan: expected IMEI or QR with BOX & DEV" }, { status: 422 });
    }

    const { data: boxRow, error: boxErr } = await supabase
      .from("boxes")
      .select("box_id, status, box_no, device")
      .eq("box_no", parsed.box_no)
      .eq("device", parsed.device)
      .maybeSingle();

    if (boxErr) return NextResponse.json({ ok: false, error: boxErr.message }, { status: 500 });
    if (!boxRow) {
      return NextResponse.json({ ok: false, error: "Box not found for this device/box number" }, { status: 404 });
    }

    const box_id = String((boxRow as any).box_id || "");

    // If QR contains IMEIs (old format), remove only those. Otherwise remove all IN items in the box.
    let itemsOut = 0;
    if (parsed.imeis.length > 0) {
      const { data: before, error: bErr } = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", box_id)
        .in("imei", parsed.imeis)
        .eq("status", "IN");
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
      itemsOut = Array.isArray(before) ? before.length : 0;
      const { error: updItemsErr } = await supabase
        .from("items")
        .update({ status: "OUT" })
        .eq("box_id", box_id)
        .in("imei", parsed.imeis)
        .eq("status", "IN");
      if (updItemsErr) return NextResponse.json({ ok: false, error: updItemsErr.message }, { status: 500 });
    } else {
      const before = await supabase
        .from("items")
        .select("*", { count: "exact", head: true })
        .eq("box_id", box_id)
        .eq("status", "IN");
      if (before.error) return NextResponse.json({ ok: false, error: before.error.message }, { status: 500 });
      itemsOut = before.count ?? 0;
      const { error: updItemsErr } = await supabase
        .from("items")
        .update({ status: "OUT" })
        .eq("box_id", box_id)
        .eq("status", "IN");
      if (updItemsErr) return NextResponse.json({ ok: false, error: updItemsErr.message }, { status: 500 });
    }

    // Update box status
    const remainingIn = await supabase
      .from("items")
      .select("*", { count: "exact", head: true })
      .eq("box_id", box_id)
      .eq("status", "IN");

    if (remainingIn.error) return NextResponse.json({ ok: false, error: remainingIn.error.message }, { status: 500 });
    const nextBoxStatus = (remainingIn.count ?? 0) === 0 ? "OUT" : "IN";
    const { error: updBoxErr } = await supabase.from("boxes").update({ status: nextBoxStatus }).eq("box_id", box_id);
    if (updBoxErr) return NextResponse.json({ ok: false, error: updBoxErr.message }, { status: 500 });

    // Audit
    try {
      const writer = admin ?? supabase;
      await writeAudit(writer, {
        action: "STOCK_OUT",
        entity: "box",
        entity_id: box_id,
        payload: {
          box_no: parsed.box_no,
          device: parsed.device,
          qty: itemsOut,
          box_status: nextBoxStatus,
          mode: parsed.imeis.length > 0 ? "partial" : "full",
        },
        created_by: user.id,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      mode: "box",
      box_id,
      box_no: parsed.box_no,
      device: parsed.device,
      items_out: itemsOut,
      box_status: nextBoxStatus,
    });
} catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
