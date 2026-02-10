import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/**
 * COMMIT:
 * - même parsing que preview
 * - boxnr = boxCol, si vide => boxCol+1
 * - crée / upsert boxes
 * - ajoute imei dans items
 * - renvoie labels: [{device, box_no, qty, qr_data, box_id}]
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { detectSessionInUrl: false },
    }
  );
}

const s = (v: any) => String(v ?? "");
const lower = (v: any) => s(v).toLowerCase();
const trim = (v: any) => s(v).trim();

function canonicalize(v: any) {
  return s(v).toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

function isImei(v: any) {
  const digits = s(v).replace(/\D/g, "");
  return digits.length === 15 ? digits : null;
}

function extractBoxNr(boxCell: any) {
  const t = trim(boxCell);
  if (!t) return null;

  const idx = t.indexOf("-");
  if (idx < 0) return null;

  const after = t.slice(idx + 1).trim();
  if (!after) return null;

  return after.replace(/\s+/g, "");
}

function resolveDeviceDisplay(
  rawDevice: string,
  devices: { canonical_name: string; device: string | null; active?: boolean | null }[]
) {
  const rawCanon = canonicalize(rawDevice);
  if (!rawCanon) return null;

  const active = (devices || []).filter((d) => d.active !== false);
  const byCanon = new Map(active.map((d) => [String(d.canonical_name || ""), d]));

  if (byCanon.has(rawCanon)) {
    const d = byCanon.get(rawCanon)!;
    return String(d.device || d.canonical_name);
  }

  let best: any = null;
  for (const d of active) {
    const dbCanon = String(d.canonical_name || "");
    if (!dbCanon) continue;
    if (rawCanon.startsWith(dbCanon)) {
      if (!best || dbCanon.length > String(best.canonical_name).length) best = d;
    }
  }
  if (best) return String(best.device || best.canonical_name);

  const m = rawCanon.match(/^([A-Z]+)(\d{3})/);
  if (m) {
    const short = m[1] + m[2];
    if (byCanon.has(short)) {
      const d = byCanon.get(short)!;
      return String(d.device || d.canonical_name);
    }
  }

  const m2 = rawCanon.match(/^([A-Z]+)(\d{1,2})$/);
  if (m2) {
    const padded = m2[1] + m2[2].padStart(3, "0");
    if (byCanon.has(padded)) {
      const d = byCanon.get(padded)!;
      return String(d.device || d.canonical_name);
    }
  }

  return null;
}

function detectHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const row = rows[r] || [];
    const hasBox = row.some((c) => lower(c).includes("box"));
    const hasImei = row.some((c) => lower(c).includes("imei"));
    if (hasBox && hasImei) return r;
  }
  return -1;
}

function detectBlocks(headerRow: any[]) {
  const header = (headerRow || []).map((c) => lower(c).replace(/\s+/g, " ").trim());
  const blocks: { boxCol: number; imeiCol: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = header[c] || "";
    const isBox = h.includes("box") && h.includes("no");
    if (!isBox) continue;

    let imeiCol = -1;
    for (let k = c; k <= Math.min(header.length - 1, c + 20); k++) {
      if ((header[k] || "").includes("imei")) {
        imeiCol = k;
        break;
      }
    }
    if (imeiCol < 0) continue;

    const dup = blocks.some((b) => Math.abs(b.boxCol - c) <= 2);
    if (dup) continue;

    blocks.push({ boxCol: c, imeiCol });
    c = imeiCol;
  }

  return blocks;
}

function getDeviceNameFromTopRow(rowAboveHeader: any[], boxCol: number, imeiCol: number) {
  const row = rowAboveHeader || [];
  for (let c = boxCol; c <= imeiCol; c++) {
    const v = trim(row[c]);
    if (v) return v;
  }
  const v2 = trim(row[boxCol]);
  return v2 || null;
}

function readBoxNrFromRow(row: any[], boxCol: number) {
  const primary = extractBoxNr(row?.[boxCol]);
  if (primary) return primary;

  const fallback = extractBoxNr(row?.[boxCol + 1]);
  if (fallback) return fallback;

  return null;
}

type ParsedLabel = { device: string; box_no: string; qty: number; qr_data: string; imeis: string[] };

async function safeInsertInboundImport(admin: any, payload: Record<string, any>) {
  const tries: Record<string, any>[] = [];
  tries.push({ ...payload });

  const drop = (obj: any, keys: string[]) => {
    const o = { ...obj };
    for (const k of keys) delete o[k];
    return o;
  };

  tries.push(drop(payload, ["created_by_email"]));
  tries.push(drop(payload, ["created_by_email", "devices"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location", "file_name"]));

  for (const t of tries) {
    const res = await admin.from("inbound_imports").insert(t).select("*").maybeSingle();
    if (!res.error) return res.data;
  }
  return null;
}

async function ensureBoxes(admin: any, labels: ParsedLabel[], location: string) {
  const dedup = new Map<string, any>();
  for (const l of labels) {
    dedup.set(`${l.device}__${l.box_no}`, {
      device: l.device,
      master_box_no: l.box_no,
      box_no: l.box_no,
      location,
      status: "IN_STOCK",
    });
  }
  const rows = Array.from(dedup.values());

  const up = await admin.from("boxes").upsert(rows, { onConflict: "device,master_box_no" }).select("box_id,device,master_box_no");
  if (up.error) {
    for (const r of rows) {
      const ins = await admin.from("boxes").insert(r);
      if (ins.error) continue;
    }
  }

  const devices = Array.from(new Set(rows.map((r) => r.device)));
  const master = Array.from(new Set(rows.map((r) => r.master_box_no)));

  const fetched = await admin.from("boxes").select("box_id,device,master_box_no,box_no").in("device", devices).in("master_box_no", master);

  const map = new Map<string, string>();
  for (const b of fetched.data || []) {
    map.set(`${b.device}__${b.master_box_no}`, String(b.box_id));
  }
  return map;
}

async function insertImeis(admin: any, boxIdMap: Map<string, string>, labels: ParsedLabel[]) {
  const rows: any[] = [];
  for (const l of labels) {
    const box_id = boxIdMap.get(`${l.device}__${l.box_no}`);
    if (!box_id) continue;
    for (const imei of Array.from(new Set(l.imeis))) {
      rows.push({ box_id, imei, status: "IN_STOCK" });
    }
  }

  const r = await admin.from("items").insert(rows);
  if (!r.error) return { table: "items", inserted: rows.length };

  const r2 = await admin.from("box_items").insert(rows.map(({ status, ...x }) => x));
  if (!r2.error) return { table: "box_items", inserted: rows.length };

  return { table: null, inserted: 0 };
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { data: uData, error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const created_by_email = uData.user?.email || null;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = trim(form.get("location"));

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const { data: devicesDb, error: dErr } = await admin.from("devices").select("canonical_name, device, active");
    if (dErr) return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows?.length) return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });

    const headerRowIdx = detectHeaderRow(rows);
    if (headerRowIdx < 0) {
      return NextResponse.json({ ok: false, error: "Could not detect header row (need BOX + IMEI headers)" }, { status: 400 });
    }

    const blocks = detectBlocks(rows[headerRowIdx] || []);
    if (!blocks.length) {
      return NextResponse.json({ ok: false, error: "No blocks detected (Box No + IMEI)" }, { status: 400 });
    }

    const rowAbove = rows[headerRowIdx - 1] || [];
    const unknown = new Set<string>();
    const map = new Map<string, { device: string; box_no: string; imeis: string[] }>();

    for (const b of blocks) {
      const rawTopDevice = getDeviceNameFromTopRow(rowAbove, b.boxCol, b.imeiCol);
      if (!rawTopDevice) continue;

      const deviceDisplay = resolveDeviceDisplay(rawTopDevice, devicesDb || []);
      if (!deviceDisplay) {
        unknown.add(rawTopDevice);
        continue;
      }

      let currentBoxNr: string | null = null;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        const bn = readBoxNrFromRow(row, b.boxCol);
        if (bn) currentBoxNr = bn;

        const imei = isImei(row[b.imeiCol]);
        if (!imei || !currentBoxNr) continue;

        const key = `${deviceDisplay}__${currentBoxNr}`;
        if (!map.has(key)) map.set(key, { device: deviceDisplay, box_no: currentBoxNr, imeis: [] });
        map.get(key)!.imeis.push(imei);
      }
    }

    if (unknown.size) {
      return NextResponse.json(
        {
          ok: false,
          error: "device(s) not found in Admin > Devices",
          unknown_devices: Array.from(unknown).sort(),
        },
        { status: 400 }
      );
    }

    const labels: ParsedLabel[] = Array.from(map.values())
      .map((x) => {
        const uniq = Array.from(new Set(x.imeis));
        return { device: x.device, box_no: x.box_no, qty: uniq.length, imeis: uniq, qr_data: uniq.join("\n") };
      })
      .filter((l) => l.qty > 0)
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json({ ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." }, { status: 400 });
    }

    const devicesDetected = new Set(labels.map((l) => l.device)).size;

    const importRow = await safeInsertInboundImport(admin, {
      file_name: file.name,
      location,
      devices: devicesDetected,
      created_by_email,
    });

    const boxIdMap = await ensureBoxes(admin, labels, location);
    const ins = await insertImeis(admin, boxIdMap, labels);

    const labelsOut = labels.map((l) => ({
      device: l.device,
      box_no: l.box_no,
      qty: l.qty,
      qr_data: l.qr_data,
      box_id: boxIdMap.get(`${l.device}__${l.box_no}`) || null,
    }));

    return NextResponse.json({
      ok: true,
      import: importRow ? { ...importRow } : null,
      file_name: file.name,
      location,
      devices: devicesDetected,
      boxes: labels.length,
      items: labels.reduce((acc, l) => acc + l.qty, 0),
      inserted_into: ins.table,
      inserted_items: ins.inserted,
      labels: labelsOut,
      debug: {
        header_row_index: headerRowIdx,
        blocks: blocks.map((b) => ({ boxCol: b.boxCol, imeiCol: b.imeiCol, fallbackBoxCol: b.boxCol + 1 })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}