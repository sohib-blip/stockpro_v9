import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/**
 * ✅ SECURE: DB writes with service role key (server-side only)
 * Requires env:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (recommended) OR SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY (for authed client)
 */

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function norm(v: any) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isImei(v: any) {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

function canonicalize(s: string) {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function extractMasterBoxNo(boxCell: any): string | null {
  const s = String(boxCell ?? "").trim();
  if (!s) return null;

  // ex: FMB140BTZ9FD-076-004  -> 076-004
  const m = s.match(/(\d{3}-\d{3})\s*$/);
  if (m) return m[1];

  // fallback: find any 000-000 inside
  const m2 = s.match(/(\d{3}-\d{3})/);
  return m2 ? m2[1] : null;
}

function extractRawDeviceFromBoxCell(boxCell: any): string | null {
  const s = String(boxCell ?? "").trim();
  if (!s) return null;
  const p = s.split("-")[0]?.trim(); // before first dash
  return p || null;
}

async function loadDeviceCanonicals(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin!
    .from("devices")
    .select("canonical_name, device, active")
    .eq("active", true);

  if (error) return [];
  return (data || []).map((d: any) => ({
    canonical: String(d.canonical_name || ""),
    display: String(d.device || d.canonical_name || ""),
  }));
}

function resolveDeviceDisplay(rawDevice: string, deviceList: { canonical: string; display: string }[]) {
  const rawCanon = canonicalize(rawDevice);
  if (!rawCanon) return null;

  // longest canonical prefix match
  let best: { canonical: string; display: string } | null = null;
  for (const d of deviceList) {
    if (!d.canonical) continue;
    if (rawCanon.startsWith(d.canonical)) {
      if (!best || d.canonical.length > best.canonical.length) best = d;
    }
  }
  return best ? best.display : null;
}

function detectHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const row = rows[r] || [];
    const cells = row.map(norm);
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) return r;
  }
  return -1;
}

/**
 * Detect repeated blocks (multi-device):
 * find columns where header looks like "Box No." then an IMEI exists within next ~18 cols
 */
function detectBlocks(header: string[]) {
  const blocks: { start: number; boxCol: number; imeiCol: number; deviceHintCol: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = header[c] || "";
    const isBox = h === "box no." || (h.includes("box") && h.includes("no"));
    if (!isBox) continue;

    let imeiCol = -1;
    for (let k = c; k <= Math.min(header.length - 1, c + 18); k++) {
      if ((header[k] || "").includes("imei")) {
        imeiCol = k;
        break;
      }
    }
    if (imeiCol < 0) continue;

    // prevent duplicates
    const already = blocks.some((b) => Math.abs(b.start - c) <= 2);
    if (already) continue;

    blocks.push({ start: c, boxCol: c, imeiCol, deviceHintCol: c });
  }

  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

type ParsedLabel = {
  device: string;
  box_no: string; // master box no (gros carton)
  qty: number;
  qr_data: string; // imei-only, one per line
  imeis: string[];
};

async function safeInsertInboundImport(admin: ReturnType<typeof adminClient>, payload: Record<string, any>) {
  // inbound_imports schema can differ. We'll progressively remove unknown columns.
  const tries: Record<string, any>[] = [];

  // most complete
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
  tries.push({}); // last resort

  for (const t of tries) {
    const res = await admin!.from("inbound_imports").insert(t as any).select("*").maybeSingle();
    if (!res.error) return res.data;

    const msg = String(res.error.message || "").toLowerCase();
    if (msg.includes("relation") && msg.includes("does not exist")) break;
  }
  return null;
}

async function ensureBoxes(
  admin: ReturnType<typeof adminClient>,
  labels: ParsedLabel[],
  location: string
) {
  const uniquePairs = labels.map((l) => ({
    device: l.device,
    master_box_no: l.box_no,
    box_no: l.box_no,
    location,
    status: "IN_STOCK",
  }));

  // dedup
  const dedupMap = new Map<string, any>();
  for (const r of uniquePairs) dedupMap.set(`${r.device}__${r.master_box_no}`, r);
  const rows = Array.from(dedupMap.values());

  // Try upsert
  let upsertOk = false;
  {
    const res = await admin!
      .from("boxes")
      .upsert(rows as any, { onConflict: "device,master_box_no" })
      .select("box_id, device, master_box_no, box_no, location");

    if (!res.error) upsertOk = true;
  }

  // Fallback insert
  if (!upsertOk) {
    for (const r of rows) {
      const ins = await admin!.from("boxes").insert(r as any);
      if (ins.error) {
        const msg = String(ins.error.message || "").toLowerCase();
        if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("unique")) continue;
        continue;
      }
    }
  }

  // Fetch map
  const devices = Array.from(new Set(rows.map((r) => r.device)));
  const masterBoxNos = Array.from(new Set(rows.map((r) => r.master_box_no)));

  const fetched = await admin!
    .from("boxes")
    .select("box_id, device, master_box_no, box_no, location")
    .in("device", devices)
    .in("master_box_no", masterBoxNos);

  const map = new Map<string, string>();
  for (const b of fetched.data || []) {
    map.set(`${b.device}__${b.master_box_no}`, String((b as any).box_id));
  }
  return map;
}

async function insertImeis(
  admin: ReturnType<typeof adminClient>,
  boxIdMap: Map<string, string>,
  labels: ParsedLabel[]
) {
  const rows: any[] = [];
  for (const l of labels) {
    const box_id = boxIdMap.get(`${l.device}__${l.box_no}`);
    if (!box_id) continue;

    const uniq = Array.from(new Set(l.imeis));
    for (const imei of uniq) rows.push({ box_id, imei, status: "IN_STOCK" });
  }

  // Try items table
  {
    const res = await admin!.from("items").insert(rows as any);
    if (!res.error) return { table: "items", inserted: rows.length };
  }

  // Try box_items fallback
  {
    const rows2: any[] = [];
    for (const l of labels) {
      const box_id = boxIdMap.get(`${l.device}__${l.box_no}`);
      if (!box_id) continue;
      const uniq = Array.from(new Set(l.imeis));
      for (const imei of uniq) rows2.push({ box_id, imei });
    }
    const res2 = await admin!.from("box_items").insert(rows2 as any);
    if (!res2.error) return { table: "box_items", inserted: rows2.length };
  }

  return { table: null, inserted: 0 };
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Missing service role key on server" }, { status: 500 });
    }

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const userClient = authedClient(token);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const created_by_email = userData.user?.email || null;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") ?? "").trim();

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    if (!location) return NextResponse.json({ ok: false, error: "Missing location" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!rows?.length) return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });

    const headerRowIdx = detectHeaderRow(rows);
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect header row (need BOX + IMEI headers)" },
        { status: 400 }
      );
    }

    const header = (rows[headerRowIdx] || []).map(norm);
    const blocks = detectBlocks(header);
    if (!blocks.length) {
      return NextResponse.json(
        { ok: false, error: "No blocks detected. Expected repeated 'Box No.' + 'IMEI' sections." },
        { status: 400 }
      );
    }

    const deviceList = await loadDeviceCanonicals(admin);

    // Parse all blocks (supports 3,4,5+ blocks)
    const byKey = new Map<string, { device: string; box_no: string; imeis: string[] }>();

    for (const block of blocks) {
      // top row sometimes contains device hint
      const row0 = rows[0] || [];
      const deviceHintRaw = String(row0[block.deviceHintCol] ?? "").trim();

      let currentDeviceDisplay: string | null =
        deviceHintRaw ? resolveDeviceDisplay(deviceHintRaw, deviceList) : null;

      let currentMasterBox: string | null = null;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const boxCell = row[block.boxCol];
        const imeiCell = row[block.imeiCol];

        // update current device/master box when box cell is present
        if (boxCell !== null && boxCell !== undefined && String(boxCell).trim() !== "") {
          const rawDev = extractRawDeviceFromBoxCell(boxCell);
          const mb = extractMasterBoxNo(boxCell);

          if (rawDev) {
            const resolved = resolveDeviceDisplay(rawDev, deviceList);
            if (resolved) currentDeviceDisplay = resolved;
          }
          if (mb) currentMasterBox = mb;
        }

        const imei = isImei(imeiCell);
        if (!imei) continue;

        if (!currentDeviceDisplay || !currentMasterBox) continue;

        const key = `${currentDeviceDisplay}__${currentMasterBox}`;
        if (!byKey.has(key)) byKey.set(key, { device: currentDeviceDisplay, box_no: currentMasterBox, imeis: [] });
        byKey.get(key)!.imeis.push(imei);
      }
    }

    const labels: ParsedLabel[] = Array.from(byKey.values())
      .map((x) => {
        const uniq = Array.from(new Set(x.imeis));
        return {
          device: x.device,
          box_no: x.box_no,
          qty: uniq.length,
          imeis: uniq,
          qr_data: uniq.join("\n"), // ✅ IMEI only, 1 per line
        };
      })
      .filter((l) => l.qty > 0)
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." },
        { status: 400 }
      );
    }

    const devicesDetected = new Set(labels.map((l) => l.device)).size;

    // 1) log import (schema-safe)
    const importRow = await safeInsertInboundImport(admin, {
      file_name: file.name,
      location,
      devices: devicesDetected,
      created_by_email,
    });

    // 2) ensure boxes exist
    const boxIdMap = await ensureBoxes(admin, labels, location);

    // 3) insert imeis
    const ins = await insertImeis(admin, boxIdMap, labels);

    // ✅ attach box_id per label (so UI can generate PDF after confirm)
    const labelsWithBoxId = labels.map((l) => ({
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
      labels: labelsWithBoxId,
      debug: {
        header_row_index: headerRowIdx,
        blocks_detected: blocks.map((b) => ({ start: b.start, boxCol: b.boxCol, imeiCol: b.imeiCol })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}