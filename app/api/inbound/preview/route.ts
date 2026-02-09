import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type Location = "00" | "1" | "6" | "cabinet";
const ALLOWED_LOCATIONS: Location[] = ["00", "1", "6", "cabinet"];

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function s(v: any) {
  return String(v ?? "").trim();
}

function toUpperNoWeird(v: any) {
  return s(v).toUpperCase();
}

function canonicalizeDeviceFromBoxLeftPart(left: string) {
  // left example: "FMB140BTZ9FD" OR "FMB 140BTZ9FD"
  // expected canonical: "FMB140"
  const up = left.toUpperCase().trim();
  const m = up.match(/^([A-Z]+)\s*([0-9]+)/);
  if (m) return `${m[1]}${m[2]}`;
  // fallback: keep letters+digits prefix only
  const m2 = up.replace(/\s+/g, "").match(/^([A-Z0-9]{3,10})/);
  return m2 ? m2[1] : up.replace(/\s+/g, "").slice(0, 10);
}

function looksLikeBoxNo(v: any) {
  const t = toUpperNoWeird(v).replace(/\s+/g, "");
  // must contain "-ddd-ddd" at end (ex: ...-076-004)
  return /-\d{3}-\d{3}$/.test(t);
}

function parseBoxCell(v: any): { canonical: string; box_no: string; raw: string } | null {
  const raw = toUpperNoWeird(v);
  const compact = raw.replace(/\s+/g, "");
  // expecting "...-076-004"
  const m = compact.match(/^(.*)-(\d{3}-\d{3})$/);
  if (!m) return null;
  const left = m[1]; // device+suffix
  const box_no = m[2];
  const canonical = canonicalizeDeviceFromBoxLeftPart(left);
  if (!canonical || !box_no) return null;
  return { canonical, box_no, raw };
}

function normalizeImei(v: any): string | null {
  if (v === null || v === undefined) return null;

  // Excel peut donner un number -> on transforme sans .0
  let t = String(v).trim();
  if (!t) return null;

  // remove .0 if numeric formatted
  if (/^\d+\.0$/.test(t)) t = t.split(".")[0];

  // keep digits only
  const digits = t.replace(/\D/g, "");
  if (digits.length !== 15) return null;
  return digits;
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
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const locationRaw = s(form.get("location") ?? "00");
    const location = (ALLOWED_LOCATIONS.includes(locationRaw as Location) ? locationRaw : "00") as Location;

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // Load devices map (canonical_name -> display)
    const devicesMap = new Map<string, string>();
    try {
      const { data } = await supabase
        .from("devices")
        .select("canonical_name, device, active")
        .eq("active", true);

      (data || []).forEach((d: any) => {
        const can = String(d.canonical_name ?? "").toUpperCase().trim();
        const disp = String(d.device ?? d.canonical_name ?? "").trim();
        if (can) devicesMap.set(can, disp || can);
      });
    } catch {
      // non-blocking
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!grid || grid.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    // Compute max cols
    const maxCols = grid.reduce((m, row) => Math.max(m, (row || []).length), 0);

    // Detect "BOX columns" by scanning all columns for box patterns frequency
    const boxCols: number[] = [];
    for (let c = 0; c < maxCols; c++) {
      let hits = 0;
      for (let r = 0; r < grid.length; r++) {
        const v = grid[r]?.[c];
        if (looksLikeBoxNo(v)) hits++;
        // early stop if enough hits
        if (hits >= 2) break;
      }
      if (hits >= 2) boxCols.push(c);
    }

    if (boxCols.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No BoxNo column detected (expected values like ...-076-004)" },
        { status: 400 }
      );
    }

    boxCols.sort((a, b) => a - b);

    // Parse by blocks: each box column owns columns until next box column - 1
    type BoxAgg = {
      canonical: string;
      device: string;
      box_no: string;
      location: Location;
      imeis: Set<string>;
    };

    const boxes = new Map<string, BoxAgg>();

    for (let bi = 0; bi < boxCols.length; bi++) {
      const boxCol = boxCols[bi];
      const nextBoxCol = bi < boxCols.length - 1 ? boxCols[bi + 1] : maxCols;
      const scanStart = boxCol + 1;
      const scanEnd = Math.max(scanStart, nextBoxCol - 1);

      let currentKey: string | null = null;

      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        const boxCell = row[boxCol];
        const parsed = looksLikeBoxNo(boxCell) ? parseBoxCell(boxCell) : null;

        if (parsed) {
          const canonical = parsed.canonical;
          const box_no = parsed.box_no;

          const display = devicesMap.get(canonical) ?? canonical; // fallback
          const key = `${canonical}__${box_no}`;

          if (!boxes.has(key)) {
            boxes.set(key, {
              canonical,
              device: display,
              box_no,
              location,
              imeis: new Set<string>(),
            });
          }
          currentKey = key;
        }

        if (!currentKey) continue;

        // Collect all IMEIs in this block for this row
        for (let c = scanStart; c <= scanEnd; c++) {
          const imei = normalizeImei(row[c]);
          if (imei) boxes.get(currentKey)!.imeis.add(imei);
        }
      }
    }

    const labelRows = Array.from(boxes.values())
      .map((b) => {
        const imeis = Array.from(b.imeis);
        imeis.sort(); // stable output
        return {
          device: b.device,
          canonical: b.canonical,
          box_no: b.box_no,
          location: b.location,
          qty: imeis.length,
          qr_data: imeis.join("\n"),
        };
      })
      .filter((x) => x.qty > 0);

    if (labelRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." },
        { status: 400 }
      );
    }

    // Stats
    const devicesSet = new Set(labelRows.map((x) => x.device));
    const items = labelRows.reduce((acc, x) => acc + x.qty, 0);

    // ZPL
    const zpl_all = labelRows
      .map((l) => buildZplLabel(l.qr_data, l.device, l.box_no))
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: devicesSet.size,
      boxes: labelRows.length,
      items,
      labels: labelRows.map(({ device, box_no, qty, qr_data }) => ({ device, box_no, qty, qr_data })),
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}