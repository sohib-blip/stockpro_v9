import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

type Location = "00" | "1" | "6" | "cabinet";
const ALLOWED_LOCATIONS: Location[] = ["00", "1", "6", "cabinet"];

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function digitsOnly(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function normalizeImei(v: any): string | null {
  if (v === null || v === undefined) return null;

  let t = String(v).trim();
  if (!t) return null;

  if (/^\d+\.0$/.test(t)) t = t.split(".")[0];

  const d = digitsOnly(t);
  if (d.length !== 15) return null;
  return d;
}

// Box cell example: "FMC9202MAUWU-041-053"
function parseBoxCell(v: any): { deviceRaw: string; box_no: string } | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  const compact = s.replace(/\s+/g, "");
  // must end with -ddd-ddd
  const m = compact.match(/^(.*)-(\d{3})-(\d{3})$/);
  if (!m) return null;

  const deviceRaw = String(m[1] ?? "").trim();
  const box_no = `${m[2]}-${m[3]}`;

  // IMPORTANT: deviceRaw must contain at least one letter (to avoid pure "041-240")
  if (!/[A-Z]/i.test(deviceRaw)) return null;

  return { deviceRaw, box_no };
}

function canonicalize(input: string) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

// Extract canonical like FMC920 or FMB140 from "FMC9202MAUWU" or "FMB 140BTZ9FD"
function canonicalFromDeviceRaw(deviceRaw: string) {
  const up = String(deviceRaw ?? "").toUpperCase().trim();
  const m = up.match(/^([A-Z]+)\s*([0-9]+)/);
  if (m) return `${m[1]}${m[2]}`;
  const c = canonicalize(up);
  return c.slice(0, 8);
}

function findHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 80); r++) {
    const cells = (rows[r] || []).map((x) => norm(x));
    const hasBox = cells.some((c) => c.includes("box") && c.includes("no"));
    const hasImei = cells.some((c) => c.includes("imei"));
    if (hasBox && hasImei) return r;
  }
  return -1;
}

function pickBestDevice(
  devices: Array<{ canonical_name: string; device?: string | null }>,
  deviceRaw: string
) {
  const rawCan = canonicalize(deviceRaw);
  if (!rawCan) return null;

  let best: { canonical_name: string; device?: string | null } | null = null;
  for (const d of devices) {
    const can = canonicalize(d.canonical_name);
    if (!can) continue;
    if (rawCan.startsWith(can)) {
      if (!best || can.length > canonicalize(best.canonical_name).length) best = d;
    }
  }

  if (!best) {
    const fallback = canonicalFromDeviceRaw(deviceRaw);
    best = devices.find((d) => canonicalize(d.canonical_name) === canonicalize(fallback)) || null;
  }

  return best;
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

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const loc = String(form.get("location") ?? "00").toLowerCase().trim();
    const location = (ALLOWED_LOCATIONS.includes(loc as Location) ? (loc as Location) : "00") as Location;

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // Devices from DB
    const devRes = await admin.from("devices").select("canonical_name, device, active").eq("active", true);
    if (devRes.error) return NextResponse.json({ ok: false, error: devRes.error.message }, { status: 400 });
    const devices = (devRes.data || []) as Array<{ canonical_name: string; device?: string | null }>;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    const headerRowIdx = findHeaderRow(rows);
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect header row (need 'Box No' + 'IMEI')." },
        { status: 400 }
      );
    }

    const header = (rows[headerRowIdx] || []).map((x) => norm(x));
    const maxCols = header.length;

    // 1) Find all columns that are "Box No" by header
    const boxHeaderCols: number[] = [];
    for (let c = 0; c < maxCols; c++) {
      const h = header[c] || "";
      if (h.includes("box") && h.includes("no")) boxHeaderCols.push(c);
    }
    if (boxHeaderCols.length === 0) {
      return NextResponse.json({ ok: false, error: "No 'Box No' column found in header." }, { status: 400 });
    }

    // 2) Keep ONLY "primary box columns" that actually contain device+box like "FMC920...-041-053"
    const startRow = headerRowIdx + 1;
    const primaryBoxCols: number[] = [];
    for (const c of boxHeaderCols) {
      let hits = 0;
      for (let r = startRow; r < Math.min(rows.length, startRow + 400); r++) {
        const parsed = parseBoxCell(rows[r]?.[c]);
        if (parsed) {
          hits++;
          if (hits >= 1) break; // 1 hit is enough to confirm it's a primary box col
        }
      }
      if (hits >= 1) primaryBoxCols.push(c);
    }

    if (primaryBoxCols.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No primary Box column detected. Expected cells like 'FMC920...-041-053'." },
        { status: 400 }
      );
    }

    primaryBoxCols.sort((a, b) => a - b);

    // 3) Build blocks using ONLY primaryBoxCols
    const blocks = primaryBoxCols.map((boxCol, idx) => {
      const next = idx < primaryBoxCols.length - 1 ? primaryBoxCols[idx + 1] : maxCols;

      const imeiCols: number[] = [];
      for (let c = boxCol + 1; c < next; c++) {
        if ((header[c] || "").includes("imei")) imeiCols.push(c);
      }

      return { boxCol, next, imeiCols };
    });

    const lastBoxByBlock: Record<string, { deviceRaw: string; box_no: string } | null> = {};
    const imeisByKey = new Map<string, Set<string>>(); // key = canonical|box_no

    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r] || [];

      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const boxCell = row[b.boxCol];

        const parsed = parseBoxCell(boxCell);
        if (parsed) lastBoxByBlock[String(bi)] = parsed;

        const current = lastBoxByBlock[String(bi)];
        if (!current) continue;

        const foundImeis: string[] = [];

        if (b.imeiCols.length > 0) {
          for (const c of b.imeiCols) {
            const imei = normalizeImei(row[c]);
            if (imei) foundImeis.push(imei);
          }
        } else {
          // fallback: scan all columns until next block
          for (let c = b.boxCol + 1; c < b.next; c++) {
            const imei = normalizeImei(row[c]);
            if (imei) foundImeis.push(imei);
          }
        }

        if (foundImeis.length === 0) continue;

        const best = pickBestDevice(devices, current.deviceRaw);
        const canonical = best?.canonical_name || canonicalFromDeviceRaw(current.deviceRaw);

        const key = `${canonical}|${current.box_no}`;
        if (!imeisByKey.has(key)) imeisByKey.set(key, new Set<string>());
        const set = imeisByKey.get(key)!;
        for (const imei of foundImeis) set.add(imei);
      }
    }

    if (imeisByKey.size === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." },
        { status: 400 }
      );
    }

    const labels = Array.from(imeisByKey.entries()).map(([key, set]) => {
      const [canonical_name, box_no] = key.split("|");
      const d = devices.find((x) => x.canonical_name === canonical_name);
      const device = (d?.device || d?.canonical_name || canonical_name).trim();

      const imeis = Array.from(set);
      imeis.sort();
      const qr_data = imeis.join("\n");

      return { device, box_no, qty: imeis.length, qr_data, canonical_name };
    });

    labels.sort((a, b) => (a.canonical_name + a.box_no).localeCompare(b.canonical_name + b.box_no));

    const zpl_all = labels.map((l) => buildZplLabel(l.qr_data, l.device, l.box_no)).join("\n\n");

    return NextResponse.json({
      ok: true,
      mode: "preview",
      file_name: file.name,
      location,
      devices: new Set(labels.map((x) => x.canonical_name)).size,
      boxes: labels.length,
      items: labels.reduce((acc, x) => acc + x.qty, 0),
      labels: labels.map(({ device, box_no, qty, qr_data }) => ({ device, box_no, qty, qr_data })),
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}