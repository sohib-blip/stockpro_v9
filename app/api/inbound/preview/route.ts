import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/**
 * PREVIEW endpoint
 * - Reads supplier Excel (multi-devices in columns blocks)
 * - Extracts device + master box + IMEIs per big carton (boxnr)
 * - Supports blocks where box cell is:
 *    A) "FMC880LOAUWU-026-001"  (device+boxnr)
 *    B) "026-001" or "041-2"    (boxnr only)  -> device comes from block header (row 1)
 */

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function canonDeviceDisplayFromTopCell(v: any) {
  // "FMC880LOAUWU" -> "FMC 880"
  // "FMB140BTZ9FD" -> "FMB 140"
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^([A-Za-z]{2,4})\s*0*(\d{2,4})/);
  if (!m) return s;
  return `${m[1].toUpperCase()} ${m[2]}`;
}

function canonKey(deviceDisplay: string) {
  // "FMC 880" -> "FMC880"
  return deviceDisplay.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isLikelyDeviceTopCell(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  // expect starts with letters + digits
  return /^[A-Za-z]{2,6}\s*\d{2,5}/.test(s);
}

function padBoxNr(box: string) {
  // "041-2" -> "041-002"
  const s = String(box ?? "").trim();
  const m = s.match(/^(\d{1,3})-(\d{1,3})$/);
  if (!m) return s;
  const a = m[1].padStart(3, "0");
  const b = m[2].padStart(3, "0");
  return `${a}-${b}`;
}

function extractBoxFromCell(raw: any, fallbackDeviceDisplay: string) {
  // returns { deviceDisplay, boxNo } or null
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Case A: "FMC880LOAUWU-026-001" or "FMB140BTZ9FD-076-004"
  // Device prefix = letters+digits at start, box = last two -parts
  const mA = s.match(/^([A-Za-z]{2,6}\s*\d{2,5}[A-Za-z0-9]*)-(\d{1,3})-(\d{1,3})$/);
  if (mA) {
    const deviceTop = canonDeviceDisplayFromTopCell(mA[1]); // "FMC 880"
    const boxNo = `${mA[2].padStart(3, "0")}-${mA[3].padStart(3, "0")}`;
    return { deviceDisplay: deviceTop || fallbackDeviceDisplay, boxNo };
  }

  // Case B: box only "026-001" or "041-2"
  const mB = s.match(/^(\d{1,3})-(\d{1,3})$/);
  if (mB) {
    return { deviceDisplay: fallbackDeviceDisplay, boxNo: padBoxNr(`${mB[1]}-${mB[2]}`) };
  }

  return null;
}

function parseImei(v: any) {
  // Excel might give number, string, scientific notation, etc.
  let s = String(v ?? "").trim();
  if (!s) return null;

  // convert "8.62272085150474E+14" -> "862272085150474" (best effort)
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = Math.trunc(n).toString();
  }

  // remove spaces and non-digits
  const digits = s.replace(/\D/g, "");
  if (digits.length === 15) return digits;
  return null;
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") ?? "").trim();
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!grid || grid.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    // Find header row (the row that contains at least one "imei")
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 20); r++) {
      const row = grid[r] || [];
      const cells = row.map((x) => norm(x));
      if (cells.some((c) => c.includes("imei"))) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx < 0) {
      return NextResponse.json({ ok: false, error: "Header row not found (IMEI headers missing)" }, { status: 400 });
    }

    const topRow = (grid[headerRowIdx - 1] || []) as any[]; // usually row 1
    const header = (grid[headerRowIdx] || []).map((x) => norm(x));

    // Detect blocks: a block starts when topRow has a device-like value AND header has "box" in same column
    const starts: number[] = [];
    for (let c = 0; c < header.length; c++) {
      const top = topRow[c];
      const h = header[c] || "";
      if (isLikelyDeviceTopCell(top) && h.includes("box")) {
        starts.push(c);
      }
    }
    if (starts.length === 0) {
      // fallback: still try by scanning for box headers grouped
      for (let c = 0; c < header.length; c++) {
        if (header[c]?.includes("box")) starts.push(c);
      }
    }
    const uniqueStarts = Array.from(new Set(starts)).sort((a, b) => a - b);

    // Build blocks: [start, end]
    const blocks = uniqueStarts.map((s, i) => {
      const e = i < uniqueStarts.length - 1 ? uniqueStarts[i + 1] - 1 : header.length - 1;
      return { start: s, end: e };
    });

    // Data structure: deviceKey -> boxNo -> list of imeis
    const map: Record<string, { device: string; boxes: Record<string, string[]> }> = {};

    for (const b of blocks) {
      // Device from top cell at block start
      const deviceDisplay = canonDeviceDisplayFromTopCell(topRow[b.start]) || "";
      if (!deviceDisplay) continue;

      // Find box columns and imei column inside this block range
      const boxCols: number[] = [];
      let imeiCol: number | null = null;

      for (let c = b.start; c <= b.end; c++) {
        const h = header[c] || "";
        if (h.includes("box")) boxCols.push(c);
        if (imeiCol === null && h.includes("imei")) imeiCol = c;
      }

      if (!imeiCol || boxCols.length === 0) continue;

      const deviceKey = canonKey(deviceDisplay);
      if (!map[deviceKey]) map[deviceKey] = { device: deviceDisplay, boxes: {} };

      let currentBoxNo: string | null = null;

      // iterate data rows
      for (let r = headerRowIdx + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        // quick stop: if whole block range is empty on this row, skip
        const slice = row.slice(b.start, b.end + 1);
        const any = slice.some((v) => String(v ?? "").trim() !== "");
        if (!any) continue;

        // detect box from any box column (prefer first box col, else second, etc.)
        let foundBox: { deviceDisplay: string; boxNo: string } | null = null;
        for (const bc of boxCols) {
          const candidate = extractBoxFromCell(row[bc], deviceDisplay);
          if (candidate) {
            foundBox = candidate;
            break;
          }
        }

        if (foundBox?.boxNo) {
          currentBoxNo = foundBox.boxNo;
          // if the cell had a more precise device (rare), update display
          if (foundBox.deviceDisplay) map[deviceKey].device = foundBox.deviceDisplay;
          if (!map[deviceKey].boxes[currentBoxNo]) map[deviceKey].boxes[currentBoxNo] = [];
        }

        // parse imei
        const imei = parseImei(row[imeiCol]);
        if (imei && currentBoxNo) {
          map[deviceKey].boxes[currentBoxNo] = map[deviceKey].boxes[currentBoxNo] || [];
          map[deviceKey].boxes[currentBoxNo].push(imei);
        }
      }
    }

    // Build labels output
    const labels: Array<{ device: string; box_no: string; qty: number; qr_data: string }> = [];
    for (const dk of Object.keys(map)) {
      const device = map[dk].device;
      const boxes = map[dk].boxes;
      for (const box_no of Object.keys(boxes)) {
        const imeis = boxes[box_no].filter(Boolean);
        if (imeis.length === 0) continue;
        labels.push({
          device,
          box_no,
          qty: imeis.length,
          qr_data: imeis.join("\n"),
        });
      }
    }

    // sort nice
    labels.sort((a, b) => {
      const d = a.device.localeCompare(b.device);
      if (d !== 0) return d;
      return a.box_no.localeCompare(b.box_no);
    });

    const devicesCount = new Set(labels.map((x) => x.device)).size;

    if (labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." },
        { status: 400 }
      );
    }

    // ZPL all (1 label per box)
    const zpl_all = labels
      .map((l) => {
        return `
^XA
^PW600
^LL400
^CI28

^FO30,30
^BQN,2,8
^FDLA,${l.qr_data}^FS

^FO320,70
^A0N,35,35
^FD${l.device}^FS

^FO320,120
^A0N,30,30
^FDBox: ${l.box_no}^FS

^XZ`.trim();
      })
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: devicesCount,
      boxes: labels.length,
      items: labels.reduce((acc, x) => acc + x.qty, 0),
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}