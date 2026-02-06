export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

function onlyDigits(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function isValidImei(v: any) {
  const d = onlyDigits(v);
  return d.length === 15 ? d : "";
}

// "FMB 140BTZ9FD-076-004" -> canonical=FMB140, display=FMB 140, box=076-004
function parseBigBoxCell(v: any): { canonical: string; display: string; box: string } | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const s = raw.replace(/\s+/g, ""); // remove spaces: "FMB 140..." -> "FMB140..."

  // must contain -NNN-NNN at end
  const mBox = s.match(/-(\d{3})-(\d{3})$/);
  if (!mBox) return null;
  const box = `${mBox[1]}-${mBox[2]}`;

  // device prefix before first "-"
  const prefix = s.split("-")[0] || "";
  if (!prefix) return null;

  // letters+digits at start => FMB140 / FMC234
  const m = prefix.match(/^([A-Za-z]+)(\d+)/);
  if (!m) return null;

  const letters = m[1].toUpperCase();
  const digits = m[2];

  const canonical = `${letters}${digits}`;
  const display = `${letters} ${digits}`;

  return { canonical, display, box };
}

type Pair = { bigBoxCol: number; imeiCol: number };

function findHeaderRow(grid: any[][]): number {
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const row = grid[r] || [];
    const cells = row.map((x) => norm(x));
    const hasBox = cells.some((c) => c === "box no." || c === "box no" || c.includes("box"));
    const hasImei = cells.some((c) => c === "imei" || c.includes("imei"));
    if (hasBox && hasImei) return r;
  }
  return -1;
}

function detectPairs(header: string[]): Pair[] {
  const pairs: Pair[] = [];

  for (let c = 0; c < header.length; c++) {
    // ✅ only true IMEI columns (ignore S/N, Serial, etc.)
    const h = header[c] || "";
    const isImei = h === "imei" || h.includes("imei");
    if (!isImei) continue;

    // find box columns to the left (within 15 cols)
    const boxCols: number[] = [];
    for (let k = Math.max(0, c - 15); k < c; k++) {
      const hk = header[k] || "";
      const isBox = hk === "box no." || hk === "box no" || hk.includes("box");
      if (isBox) boxCols.push(k);
    }
    if (!boxCols.length) continue;

    // In your file there are two "Box No." columns: [bigBox, smallBox]
    // We want the LEFTMOST one among the last consecutive boxes -> big box.
    // So pick the minimum of the last run of "box" cols.
    // Example: boxCols could end like [0,1] => big=0
    const run: number[] = [];
    for (let i = boxCols.length - 1; i >= 0; i--) {
      if (run.length === 0) run.push(boxCols[i]);
      else {
        const prev = run[run.length - 1];
        if (boxCols[i] === prev - 1) run.push(boxCols[i]);
        else break;
      }
    }
    const bigBoxCol = Math.min(...run);

    pairs.push({ bigBoxCol, imeiCol: c });
  }

  // uniq
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const k = `${p.bigBoxCol}-${p.imeiCol}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // keep auth consistent (even if preview doesn't write)
    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const XLSX = await import("xlsx");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ ok: false, error: "No sheet found" }, { status: 400 });

    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
    if (!grid || grid.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    const headerRow = findHeaderRow(grid);
    if (headerRow < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect headers (need Box No + IMEI)" },
        { status: 400 }
      );
    }

    const header = (grid[headerRow] || []).map((x) => norm(x));
    const pairs = detectPairs(header);

    if (!pairs.length) {
      return NextResponse.json(
        { ok: false, error: "No IMEI columns detected (headers must contain 'IMEI')" },
        { status: 400 }
      );
    }

    // Group by canonical|box
    const groups = new Map<string, { device: string; canonical: string; box_no: string; imeis: Set<string> }>();

    // carry per pair (because big box cell is only filled once then empty)
    const carry = new Map<string, { canonical: string; device: string; box: string }>();

    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      for (const p of pairs) {
        const boxCell = row[p.bigBoxCol];
        const imeiCell = row[p.imeiCol];

        const carryKey = `${p.bigBoxCol}-${p.imeiCol}`;

        // update carry when big box cell present
        const parsed = parseBigBoxCell(boxCell);
        if (parsed) {
          carry.set(carryKey, { canonical: parsed.canonical, device: parsed.display, box: parsed.box });
        }

        const current = carry.get(carryKey);
        if (!current) continue;

        const imei = isValidImei(imeiCell);
        if (!imei) continue;

        const gKey = `${current.canonical}|${current.box}`;
        if (!groups.has(gKey)) {
          groups.set(gKey, {
            device: current.device,
            canonical: current.canonical,
            box_no: current.box,
            imeis: new Set<string>(),
          });
        }
        groups.get(gKey)!.imeis.add(imei);
      }
    }

    const labels = Array.from(groups.values())
      .map((g) => ({
        device: g.device,
        canonical_name: g.canonical,
        box_no: g.box_no,
        qty: g.imeis.size,
        qr_data: Array.from(g.imeis).join("\n"), // ✅ IMEI only, one per line
      }))
      .sort((a, b) => (a.canonical_name + a.box_no).localeCompare(b.canonical_name + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI column has 15-digit numbers." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      header_row_index: headerRow,
      detected_pairs: pairs,
      labels,
      stats: {
        devices_detected: new Set(labels.map((l) => l.device)).size,
        cartons: labels.length,
        imei_total: labels.reduce((acc, l) => acc + Number(l.qty || 0), 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}