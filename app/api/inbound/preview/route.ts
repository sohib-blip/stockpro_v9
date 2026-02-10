import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function canonicalize(v: any) {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function isImei(v: any) {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

type DeviceDbRow = {
  canonical_name: string;
  device: string | null;
  active: boolean | null;
};

function buildDeviceResolver(rows: DeviceDbRow[]) {
  // canonical -> display
  const list = (rows || [])
    .filter((r) => (r?.active ?? true) === true)
    .map((r) => ({
      canonical: canonicalize(r.canonical_name),
      display: String(r.device || r.canonical_name || "").trim(),
    }))
    .filter((x) => x.canonical);

  const byCanonical = new Map<string, string>();
  for (const d of list) byCanonical.set(d.canonical, d.display);

  function candidatesFromRaw(rawCanonical: string) {
    const out = new Set<string>();
    if (!rawCanonical) return out;
    out.add(rawCanonical);

    // letters + digits
    const m = rawCanonical.match(/^([A-Z]+)(\d+)$/);
    if (m) {
      const letters = m[1];
      const digits = m[2];

      // pad 2->3->4 (FMC03 -> FMC003)
      out.add(letters + digits.padStart(3, "0"));
      out.add(letters + digits.padStart(4, "0"));

      // strip last digits (FMC9202 -> FMC920)
      if (digits.length > 1) out.add(letters + digits.slice(0, -1));
      if (digits.length > 2) out.add(letters + digits.slice(0, -2));
    }

    return out;
  }

  function resolveDisplay(rawDeviceFromExcel: string) {
    const rawCan = canonicalize(rawDeviceFromExcel);
    if (!rawCan) return { display: rawDeviceFromExcel.trim(), canonical: rawCan };

    // 1) exact/candidate match
    for (const c of candidatesFromRaw(rawCan)) {
      const hit = byCanonical.get(c);
      if (hit) return { display: hit, canonical: c };
    }

    // 2) prefix best-match (longest)
    let best: { display: string; canonical: string; score: number } | null = null;
    for (const d of list) {
      if (!d.canonical) continue;

      const a = rawCan;
      const b = d.canonical;

      const isPrefix = a.startsWith(b) || b.startsWith(a);
      if (!isPrefix) continue;

      const score = Math.min(a.length, b.length); // longer = better
      if (!best || score > best.score) best = { display: d.display, canonical: d.canonical, score };
    }
    if (best) return { display: best.display, canonical: best.canonical };

    // fallback
    return { display: rawDeviceFromExcel.trim() || rawCan, canonical: rawCan };
  }

  return { resolveDisplay };
}

function extractDeviceAndBox(cell: string) {
  // Ex: "FMB140BTZ9FD-076-004" OR "FMB 140BTZ9FD-076-004"
  const raw = String(cell ?? "").trim();
  if (!raw) return null;

  const m = raw.match(/^\s*([A-Za-z]{2,5})\s*([0-9]{2,4})/);
  const prefix = m ? `${m[1].toUpperCase()} ${m[2]}` : null;

  // box nr = last two segments like 076-004
  const parts = raw.split("-").map((x) => x.trim()).filter(Boolean);
  let box_no = "";
  if (parts.length >= 2) {
    const last2 = parts.slice(-2);
    box_no = `${last2[0]}-${last2[1]}`;
  }

  return { rawDevice: prefix || raw, box_no };
}

function buildQrData(imeis: string[]) {
  // QR contains only IMEIs, one per line
  return imeis.join("\n");
}

function buildZplLabel({ qrData, device, boxNo }: { qrData: string; device: string; boxNo: string }) {
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
    const location = String(form.get("location") ?? "").trim(); // keep it but optional
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // load devices list for mapping
    const devRes = await supabase.from("devices").select("canonical_name, device, active");
    const resolver = buildDeviceResolver((devRes.data || []) as any);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!grid || grid.length === 0) return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });

    // Find header row that contains at least one IMEI + one BOX (supports multiple device blocks)
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(grid.length, 50); r++) {
      const row = grid[r] || [];
      const cells = row.map((x) => norm(x));
      const hasImei = cells.some((c) => c.includes("imei"));
      const hasBox = cells.some((c) => c.includes("box"));
      if (hasImei && hasBox) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect header row (no IMEI/BOX headers found)" },
        { status: 400 }
      );
    }

    const header = (grid[headerRowIdx] || []).map((x) => norm(x));

    // Find all IMEI columns in the sheet
    const imeiCols: number[] = [];
    for (let c = 0; c < header.length; c++) {
      if (header[c] && header[c].includes("imei")) imeiCols.push(c);
    }
    if (imeiCols.length === 0) return NextResponse.json({ ok: false, error: "No IMEI column detected" }, { status: 400 });

    // For each IMEI column, find the closest "box" column to the LEFT (same block)
    const blockPairs = imeiCols
      .map((iCol) => {
        let bestBox = -1;
        for (let c = iCol; c >= Math.max(0, iCol - 20); c--) {
          if (header[c] && header[c].includes("box")) {
            bestBox = c;
            break;
          }
        }
        return bestBox >= 0 ? { boxCol: bestBox, imeiCol: iCol } : null;
      })
      .filter(Boolean) as Array<{ boxCol: number; imeiCol: number }>;

    if (blockPairs.length === 0) {
      return NextResponse.json({ ok: false, error: "Missing required columns (no box+imei pairs found)" }, { status: 400 });
    }

    // Parse all rows after header row: collect IMEIs grouped by (device, box_no)
    const map = new Map<string, { device: string; box_no: string; imeis: string[] }>();

    for (let r = headerRowIdx + 1; r < grid.length; r++) {
      const row = grid[r] || [];

      for (const pair of blockPairs) {
        const boxCell = String(row[pair.boxCol] ?? "").trim();
        const imeiCell = row[pair.imeiCol];

        const imei = isImei(imeiCell);
        if (!imei) continue;

        const info = extractDeviceAndBox(boxCell);
        if (!info || !info.box_no) continue;

        const resolved = resolver.resolveDisplay(info.rawDevice);
        const device = resolved.display || info.rawDevice;
        const box_no = info.box_no;

        const key = `${canonicalize(device)}|${box_no}`;
        if (!map.has(key)) map.set(key, { device, box_no, imeis: [] });
        map.get(key)!.imeis.push(imei);
      }
    }

    const labels = Array.from(map.values())
      .map((x) => ({
        device: x.device,
        box_no: x.box_no,
        qty: x.imeis.length,
        qr_data: buildQrData(x.imeis),
      }))
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (labels.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits and Box No contains device+boxnr." },
        { status: 400 }
      );
    }

    const zpl_all = labels.map((l) => buildZplLabel({ qrData: l.qr_data, device: l.device, boxNo: l.box_no })).join("\n\n");

    const uniqueDevices = Array.from(new Set(labels.map((l) => l.device)));

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: uniqueDevices.length,
      boxes: labels.length,
      items: labels.reduce((acc, l) => acc + l.qty, 0),
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}