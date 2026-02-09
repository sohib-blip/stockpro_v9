import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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

  // take before first dash
  const p = s.split("-")[0]?.trim();
  return p || null;
}

async function loadDeviceCanonicals(supabase: ReturnType<typeof authedClient>) {
  const { data, error } = await supabase
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

  // pick the longest canonical that matches prefix
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
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || [];
    const cells = row.map(norm);
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) return r;
  }
  return -1;
}

/**
 * Detect repeated blocks:
 * We look for columns where header == "box no." (or includes "box") AND within next ~12 cols there is "imei".
 */
function detectBlocks(header: string[]) {
  const blocks: { start: number; boxCol: number; imeiCol: number; deviceHintCol: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = header[c] || "";
    const isBox = h === "box no." || (h.includes("box") && h.includes("no"));
    if (!isBox) continue;

    // search IMEI within next 12 cols
    let imeiCol = -1;
    for (let k = c; k <= Math.min(header.length - 1, c + 12); k++) {
      if ((header[k] || "").includes("imei")) {
        imeiCol = k;
        break;
      }
    }
    if (imeiCol < 0) continue;

    // avoid duplicates: if previous block already covers this column range, skip
    const already = blocks.some((b) => Math.abs(b.start - c) <= 2);
    if (already) continue;

    blocks.push({
      start: c,
      boxCol: c,
      imeiCol,
      deviceHintCol: c, // row 1 usually contains device in same col
    });
  }

  // sort by start col
  blocks.sort((a, b) => a.start - b.start);
  return blocks;
}

function buildZplLabel(qrData: string, device: string, boxNo: string) {
  return `
^XA
^PW600
^LL400
^CI28

^FO30,30
^BQN,2,8
^FDLA,${qrData}^FS

^FO320,70
^A0N,35,35
^FD${device}^FS

^FO320,120
^A0N,30,30
^FDBox: ${boxNo}^FS

^XZ
`.trim();
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") ?? "").trim();

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

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

    const deviceList = await loadDeviceCanonicals(supabase);

    // Parse all blocks independently
    const byKey = new Map<string, { device: string; box_no: string; imeis: string[] }>();

    for (const block of blocks) {
      // try device name from row 1 same column
      const row1 = rows[0] || [];
      const deviceHintRaw = String(row1[block.deviceHintCol] ?? "").trim();

      let currentDeviceRaw: string | null = deviceHintRaw || null;
      let currentDeviceDisplay: string | null =
        currentDeviceRaw ? resolveDeviceDisplay(currentDeviceRaw, deviceList) : null;

      let currentMasterBox: string | null = null;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        const boxCell = row[block.boxCol];
        const imeiCell = row[block.imeiCol];

        // when a new box cell appears, update context for this block
        if (boxCell !== null && boxCell !== undefined && String(boxCell).trim() !== "") {
          const rawDev = extractRawDeviceFromBoxCell(boxCell);
          const mb = extractMasterBoxNo(boxCell);

          if (rawDev) {
            currentDeviceRaw = rawDev;
            currentDeviceDisplay = resolveDeviceDisplay(rawDev, deviceList) || currentDeviceDisplay;
          }
          if (mb) currentMasterBox = mb;
        }

        const imei = isImei(imeiCell);
        if (!imei) continue;

        // Need device + master box
        if (!currentDeviceDisplay || !currentMasterBox) continue;

        const key = `${currentDeviceDisplay}__${currentMasterBox}`;
        if (!byKey.has(key)) {
          byKey.set(key, { device: currentDeviceDisplay, box_no: currentMasterBox, imeis: [] });
        }
        byKey.get(key)!.imeis.push(imei);
      }
    }

    const labels = Array.from(byKey.values())
      .map((x) => ({
        device: x.device,
        box_no: x.box_no,
        qty: x.imeis.length,
        qr_data: x.imeis.join("\n"), // ✅ IMEI only, one per line
      }))
      .filter((l) => l.qty > 0)
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." },
        { status: 400 }
      );
    }

    const devicesDetected = new Set(labels.map((l) => l.device)).size;
    const zpl_all = labels
      .map((l) => buildZplLabel(l.qr_data, l.device, l.box_no))
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: devicesDetected,
      boxes: labels.length,
      items: labels.reduce((acc, l) => acc + l.qty, 0),
      labels,
      zpl_all,
      debug: {
        header_row_index: headerRowIdx,
        blocks_detected: blocks.map((b) => ({ start: b.start, boxCol: b.boxCol, imeiCol: b.imeiCol })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}