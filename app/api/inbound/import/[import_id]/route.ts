import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    // Service role bypasses RLS for server-side PDF/history flows.
    // If not set, we'll fall back to the authed client.
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
}

function buildQrData({
  device,
  boxNo,
  masterBoxNo,
  qty,
}: {
  device: string;
  boxNo: string;
  masterBoxNo?: string | null;
  qty?: number;
}) {
  // Keep QR short. Long IMEI lists can exceed QR capacity and break PDF generation.
  const parts: string[] = [];
  parts.push(`BOX:${String(boxNo || "").trim()}`);
  parts.push(`DEV:${String(device || "").trim()}`);
  const m = String(masterBoxNo || "").trim();
  if (m) parts.push(`MASTER:${m}`);
  if (typeof qty === "number" && Number.isFinite(qty)) parts.push(`QTY:${qty}`);
  return parts.join("|");
}

export async function GET(req: Request, ctx: { params?: { import_id?: string } }) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // Be defensive: depending on Next.js runtime/bundling, `ctx.params` may be
    // missing. Fall back to parsing the last path segment.
    const importIdFromParams = (ctx as any)?.params?.import_id as string | undefined;
    const importIdFromPath = (() => {
      try {
        const u = new URL(req.url);
        const seg = u.pathname.split("/").filter(Boolean).pop();
        return seg && seg !== "import" ? seg : undefined;
      } catch {
        return undefined;
      }
    })();

    const importId = importIdFromParams || importIdFromPath;
    if (!importId || importId === "undefined") {
      return NextResponse.json({ ok: false, error: "Missing import_id" }, { status: 400 });
    }

    // Use admin client for DB reads (avoids RLS issues). Still validate the token.
    const admin = adminClient();
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
    }

    const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ? admin : authedClient(token);

    const { data: imp, error: impErr } = await supabase
      .from("inbound_imports")
      // rows_count is not guaranteed to exist in every DB version.
      .select("import_id, created_at, created_by, file_name, boxes_count, devices_count, items_count")
      .eq("import_id", importId)
      .maybeSingle();

    if (impErr) return NextResponse.json({ ok: false, error: impErr.message }, { status: 500 });
    if (!imp) return NextResponse.json({ ok: false, error: "Import not found" }, { status: 404 });

    // Add creator identity (first part of email) when possible.
    const creatorId = String((imp as any).created_by || "").trim();
    if (creatorId) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", creatorId)
        .maybeSingle();

      const email = String((prof as any)?.email || "").trim();
      if (email) {
        (imp as any).created_by_email = email;
        (imp as any).created_by_name = email.split("@")[0];
      }
    }

    const { data: impBoxes, error: ibErr } = await supabase
      .from("inbound_import_boxes")
      // NOTE: Some deployments don't store box_id in inbound_import_boxes.
      // Import-history label downloads should not depend on box_id.
      .select("box_no, master_box_no, device, qty")
      .eq("import_id", importId);

    if (ibErr) return NextResponse.json({ ok: false, error: ibErr.message }, { status: 500 });

    const labels = (impBoxes ?? []).map((b: any) => {
      const device = String(b.device ?? "");
      const box_no = String(b.box_no ?? "");
      const master_box_no = String(b.master_box_no ?? "");
      const qty = Number(b.qty ?? 0);
      return {
        // box_id is optional here; history downloads only need printable fields.
        device,
        master_box_no,
        box_no,
        qty,
        qr_data: buildQrData({ device, boxNo: box_no, masterBoxNo: master_box_no, qty }),
      };
    });

    // Also build master carton labels (big boxes) by grouping inner boxes.
    // If master_box_no is missing, we skip master labels.
    const masterMap = new Map<string, { device: string; master_box_no: string; qty: number }>();
    for (const l of labels) {
      const m = (l.master_box_no || "").trim();
      if (!m) continue;
      const key = `${l.device}__${m}`;
      const g = masterMap.get(key) ?? { device: l.device, master_box_no: m, qty: 0 };
      g.qty += Number(l.qty ?? 0);
      masterMap.set(key, g);
    }
    const masterLabels = Array.from(masterMap.values()).map((m) => ({
      device: m.device,
      master_box_no: m.master_box_no,
      qty: Number(m.qty ?? 0),
      qr_data: buildQrData({ device: m.device, boxNo: m.master_box_no, qty: Number(m.qty ?? 0) }),
    }));

    // Attach creator name/email if possible
    let created_by_email: string | null = null;
    let created_by_name: string | null = null;
    const createdBy = String((imp as any).created_by || "").trim();
    if (createdBy) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("email")
        .eq("user_id", createdBy)
        .maybeSingle();
      const email = String((prof as any)?.email || "").trim();
      if (email) {
        created_by_email = email;
        created_by_name = email.split("@")[0];
      }
    }

    return NextResponse.json({
      ok: true,
      import: { ...(imp as any), created_by_email, created_by_name },
      labels_inner: labels,
      labels_master: masterLabels,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
