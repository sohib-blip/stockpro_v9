import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { detectSessionInUrl: false },
  });
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

  const txt = t.replace(/\s+/g, "");

  if (/^\d{1,4}-\d{1,4}$/.test(txt)) return txt;

  const mAny = txt.match(/(\d{1,4}-\d{1,4})/);
  if (mAny) return mAny[1];

  const idx = txt.indexOf("-");
  if (idx < 0) return null;
  const after = txt.slice(idx + 1).trim();
  if (!after) return null;

  if (/^\d{1,4}-\d{1,4}$/.test(after)) return after;
  if (/^\d{1,4}$/.test(after)) return after;

  return null;
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

function isSeparatorRow(row: any[], boxCol: number, imeiCol: number) {
  for (let c = boxCol; c <= imeiCol; c++) {
    if (trim(row?.[c])) return false;
  }
  return true;
}

type LabelRow = { device: string; box_no: string; qty: number; qr_data: string };

async function parseTeltonikaPreview(file: File, devicesDb: any[]) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

  if (!rows?.length) throw new Error("Empty excel file");

  const headerRowIdx = detectHeaderRow(rows);
  if (headerRowIdx < 0) throw new Error("Could not detect header row (need BOX + IMEI headers)");

  const blocks = detectBlocks(rows[headerRowIdx] || []);
  if (!blocks.length) throw new Error("No blocks detected (Box No + IMEI)");

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

      if (isSeparatorRow(row, b.boxCol, b.imeiCol)) {
        currentBoxNr = null;
        continue;
      }

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
    return {
      ok: false,
      error: "device(s) not found in Admin > Devices",
      unknown_devices: Array.from(unknown).sort(),
    };
  }

  const labels: LabelRow[] = Array.from(map.values())
    .map((x) => {
      const uniq = Array.from(new Set(x.imeis));
      return { device: x.device, box_no: x.box_no, qty: uniq.length, qr_data: uniq.join("\n") };
    })
    .filter((l) => l.qty > 0)
    .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

  if (!labels.length) {
    return { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." };
  }

  return {
    ok: true,
    labels,
    devices: new Set(labels.map((l) => l.device)).size,
    boxes: labels.length,
    items: labels.reduce((acc, l) => acc + l.qty, 0),
    debug: { header_row_index: headerRowIdx, blocks: blocks.map((b) => ({ boxCol: b.boxCol, imeiCol: b.imeiCol })) },
  };
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();

    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = trim(form.get("location"));
    const vendor = (trim(form.get("vendor")) || "teltonika") as Vendor;

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const { data: devicesDb, error: dErr } = await admin.from("devices").select("canonical_name, device, active");
    if (dErr) return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });

    if (vendor !== "teltonika") {
      return NextResponse.json(
        { ok: false, error: `Parser not implemented yet for vendor: ${vendor}` },
        { status: 400 }
      );
    }

    const parsed = await parseTeltonikaPreview(file, devicesDb || []);
    if (!parsed.ok) return NextResponse.json(parsed, { status: 400 });

    return NextResponse.json({
      ok: true,
      vendor,
      location,
      file_name: file.name,
      devices: parsed.devices,
      boxes: parsed.boxes,
      items: parsed.items,
      labels: parsed.labels,
      debug: parsed.debug,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}