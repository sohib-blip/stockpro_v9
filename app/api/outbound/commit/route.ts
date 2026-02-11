// app/api/outbound/commit/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/* =========================
   ✅ CONFIG DB
========================= */
const ITEMS_TABLE = "items";
const ITEMS_IMEI_COL = "imei";
const ITEMS_STATUS_COL = "status";
const ITEMS_BOX_ID_COL = "box_id";

const BOXES_TABLE = "boxes";
const BOXES_ID_COL = "box_id";
const BOXES_STATUS_COL = "status";

const AUDIT_TABLE = "audit_events"; // fallback handled
const STATUS_IN = "IN";
const STATUS_OUT = "OUT";

/* =========================
   Supabase helpers
========================= */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normalizeImei(v: any) {
  const s = String(v ?? "").trim();
  return s.replace(/\D/g, "");
}
function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}
function uniqueImeis(imeis: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of imeis) {
    const n = normalizeImei(raw);
    if (!isLikelyImei(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function extractImeisFromExcel(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
  const imeis: string[] = [];
  for (const r of rows) {
    if (!r) continue;
    for (const cell of r) {
      const n = normalizeImei(cell);
      if (isLikelyImei(n)) imeis.push(n);
    }
  }
  return uniqueImeis(imeis);
}

async function writeAudit(
  admin: any,
  payload: any,
  created_by: string | null
) {
  // try audit_events, fallback audit_log
  const row = {
    action: "STOCK_OUT",
    entity: "outbound",
    entity_id: null,
    payload,
    created_by,
  };

  const r1 = await admin.from(AUDIT_TABLE).insert(row);
  if (!r1.error) return;

  await admin.from("audit_log").insert(row);
}

/* =========================
   POST /api/outbound/commit
   - JSON: { imeis: string[], source?: {...} }
   - FormData: file (excel) + optional exclude_imeis (json string)
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const userId = userData.user.id;

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Server misconfiguration" }, { status: 500 });

    /* ---------- Input ---------- */
    const ct = (req.headers.get("content-type") || "").toLowerCase();

    let source: { type: "file" | "manual"; filename?: string | null } = { type: "manual" };
    let imeis: string[] = [];
    let excludeImeis: string[] = [];

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

      const excludeRaw = String(form.get("exclude_imeis") || "").trim();
      if (excludeRaw) {
        try {
          const arr = JSON.parse(excludeRaw);
          excludeImeis = Array.isArray(arr) ? uniqueImeis(arr.map((x: any) => String(x ?? ""))) : [];
        } catch {
          excludeImeis = [];
        }
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      imeis = extractImeisFromExcel(bytes);
      source = { type: "file", filename: file.name || null };
    } else {
      const body = await req.json().catch(() => ({}));
      const list = Array.isArray((body as any).imeis) ? (body as any).imeis : [];
      excludeImeis = Array.isArray((body as any).exclude_imeis) ? uniqueImeis((body as any).exclude_imeis) : [];
      imeis = uniqueImeis(list.map((x: any) => String(x ?? "")));
      source = (body as any)?.source?.type === "file" ? (body as any).source : { type: "manual" };
    }

    if (imeis.length === 0) return NextResponse.json({ ok: false, error: "No valid IMEIs to commit." }, { status: 400 });

    // apply excludes
    if (excludeImeis.length > 0) {
      const ex = new Set(excludeImeis);
      imeis = imeis.filter((x) => !ex.has(x));
    }

    if (imeis.length === 0) {
      return NextResponse.json({ ok: false, error: "All IMEIs were excluded. Nothing to commit." }, { status: 400 });
    }

    /* ---------- Re-check DB (safe) ---------- */
    type ItemRow = { imei: string; status: string; box_id: string | null };
    const found: ItemRow[] = [];

    for (const part of chunk(imeis, 500)) {
      const { data, error } = await admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_IMEI_COL}, ${ITEMS_STATUS_COL}, ${ITEMS_BOX_ID_COL}`)
        .in(ITEMS_IMEI_COL, part);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      for (const r of data || []) {
        found.push({
          imei: String((r as any)[ITEMS_IMEI_COL]),
          status: String((r as any)[ITEMS_STATUS_COL] || ""),
          box_id: ((r as any)[ITEMS_BOX_ID_COL] ?? null) as string | null,
        });
      }
    }

    const foundMap = new Map<string, ItemRow>();
    for (const it of found) foundMap.set(it.imei, it);

    const missing = imeis.filter((x) => !foundMap.has(x));
    const notIn = imeis.filter((x) => foundMap.has(x) && String(foundMap.get(x)!.status).toUpperCase() !== STATUS_IN);
    const willOut = imeis.filter((x) => foundMap.has(x) && String(foundMap.get(x)!.status).toUpperCase() === STATUS_IN);

    if (willOut.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Nothing to commit: no IN-stock IMEIs found.",
          imeis_total: imeis.length,
          missing_count: missing.length,
          not_in_count: notIn.length,
        },
        { status: 400 }
      );
    }

    /* ---------- Update items -> OUT (chunk) ---------- */
    for (const part of chunk(willOut, 500)) {
      const { error: uErr } = await admin.from(ITEMS_TABLE).update({ [ITEMS_STATUS_COL]: STATUS_OUT }).in(ITEMS_IMEI_COL, part);
      if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }

    /* ---------- Update boxes status based on remaining IN ---------- */
    const affectedBoxIds = Array.from(
      new Set(
        willOut
          .map((imei) => String(foundMap.get(imei)?.box_id || ""))
          .filter(Boolean)
      )
    );

    // find boxes that still have IN after update
    const stillInSet = new Set<string>();
    for (const part of chunk(affectedBoxIds, 500)) {
      const { data: rows, error: rErr } = await admin
        .from(ITEMS_TABLE)
        .select(`${ITEMS_BOX_ID_COL}`)
        .eq(ITEMS_STATUS_COL, STATUS_IN)
        .in(ITEMS_BOX_ID_COL, part);

      if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 500 });

      for (const r of rows || []) {
        const bid = String((r as any)[ITEMS_BOX_ID_COL] || "");
        if (bid) stillInSet.add(bid);
      }
    }

    for (const boxId of affectedBoxIds) {
      const newStatus = stillInSet.has(boxId) ? STATUS_IN : STATUS_OUT;
      const { error: bErr } = await admin.from(BOXES_TABLE).update({ [BOXES_STATUS_COL]: newStatus }).eq(BOXES_ID_COL, boxId);
      if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
    }

    /* ---------- Audit ---------- */
    await writeAudit(admin, {
      source,
      committed_imeis: willOut.length,
      ignored_missing: missing.length,
      ignored_not_in: notIn.length,
      affected_boxes: affectedBoxIds.length,
      sample_imeis: willOut.slice(0, 20),
    }, userId);

    return NextResponse.json({
      ok: true,
      source,
      imeis_total: imeis.length,
      committed_imeis: willOut.length,
      ignored_missing: missing.length,
      ignored_not_in: notIn.length,
      affected_boxes: affectedBoxIds.length,
    });
  } catch (e: any) {
    console.error("Outbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}