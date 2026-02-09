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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";
  if (!key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isImei(v: any) {
  const s = String(v ?? "").replace(/\s+/g, "").trim();
  return /^\d{14,17}$/.test(s);
}

function canonicalize(v: string) {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

// "FMB 140BTZ9FD-076-004" => { deviceRaw:"FMB 140BTZ9FD", boxNo:"076-004" }
function parseBoxCell(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // support spaces + hyphen format
  const m = s.match(/^(.*?)-(\d{2,4})-(\d{2,4})$/);
  if (!m) return null;

  const deviceRaw = String(m[1] ?? "").trim();
  const boxNo = `${m[2]}-${m[3]}`;
  return { deviceRaw, boxNo, full: s };
}

function pickBestDevice(devices: Array<{ canonical_name: string; device?: string | null }>, deviceRaw: string) {
  const rawCan = canonicalize(deviceRaw); // ex: FMB140BTZ9FD
  if (!rawCan) return null;

  // best match = longest canonical_name that is a prefix of rawCan
  let best: { canonical_name: string; device?: string | null } | null = null;
  for (const d of devices) {
    const can = canonicalize(d.canonical_name);
    if (!can) continue;
    if (rawCan.startsWith(can)) {
      if (!best || can.length > canonicalize(best.canonical_name).length) best = d;
    }
  }

  // fallback: first 6-7 chars (ex FMB140 / FMC234)
  if (!best) {
    const fallback = rawCan.slice(0, 6);
    best = devices.find((d) => canonicalize(d.canonical_name) === fallback) || null;
  }

  return best;
}

function findHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = (rows[r] || []).map((x) => norm(x));
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) return r;
  }
  return -1;
}

// detect all IMEI columns and for each, select the LEFTMOST "Box No" column in that local block
function detectBlocks(header: string[]) {
  const imeiCols: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (header[i]?.includes("imei")) imeiCols.push(i);
  }

  const blocks = imeiCols.map((imeiCol) => {
    // scan left until we find a run of "box no"
    let left = imeiCol;
    while (left >= 0) {
      const h = header[left] || "";
      if (h.includes("box") && h.includes("no")) break;
      left--;
    }

    if (left < 0) return { imeiCol, boxCol: null as number | null };

    // we are on a "box no", now go further left while still "box no" (so we get the LEFTMOST one)
    let boxCol = left;
    while (boxCol - 1 >= 0) {
      const h2 = header[boxCol - 1] || "";
      if (h2.includes("box") && h2.includes("no")) boxCol--;
      else break;
    }

    return { imeiCol, boxCol };
  });

  return blocks.filter((b) => b.boxCol !== null) as Array<{ imeiCol: number; boxCol: number }>;
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

    // load devices list (canonical_name is used by import)
    const devRes = await admin.from("devices").select("canonical_name, device, active").eq("active", true);
    if (devRes.error) return NextResponse.json({ ok: false, error: devRes.error.message }, { status: 400 });
    const devices = (devRes.data || []) as Array<{ canonical_name: string; device?: string | null }>;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") ?? "00");

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!rows || rows.length === 0) return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });

    const headerRowIdx = findHeaderRow(rows);
    if (headerRowIdx < 0) {
      return NextResponse.json({ ok: false, error: "Could not detect header row (need BOX + IMEI)" }, { status: 400 });
    }

    const header = (rows[headerRowIdx] || []).map((x) => norm(x));
    const blocks = detectBlocks(header);

    if (blocks.length === 0) {
      return NextResponse.json({ ok: false, error: "Missing required columns (Box No + IMEI)" }, { status: 400 });
    }

    // Parse all blocks independently (important because Excel is side-by-side)
    // We keep lastBox per block because supplier sheet repeats box on first row only
    const lastBoxByBlock: Record<string, any> = {};
    const imeisByKey = new Map<string, string[]>(); // key = canonical|boxNo

    const startRow = headerRowIdx + 1;
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r] || [];

      for (let bi = 0; bi < blocks.length; bi++) {
        const { boxCol, imeiCol } = blocks[bi];
        const boxCell = row[boxCol];
        const imeiCell = row[imeiCol];

        if (boxCell !== undefined && String(boxCell ?? "").trim() !== "") {
          const parsed = parseBoxCell(boxCell);
          if (parsed) lastBoxByBlock[String(bi)] = parsed;
        }

        const last = lastBoxByBlock[String(bi)];
        if (!last) continue;

        if (!isImei(imeiCell)) continue;
        const imei = String(imeiCell).replace(/\s+/g, "").trim();

        const best = pickBestDevice(devices, last.deviceRaw);
        if (!best) continue;

        const key = `${best.canonical_name}|${last.boxNo}`;
        const arr = imeisByKey.get(key) || [];
        arr.push(imei);
        imeisByKey.set(key, arr);
      }
    }

    if (imeisByKey.size === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check Box No + IMEI columns." },
        { status: 400 }
      );
    }

    // Build labels
    const labels = Array.from(imeisByKey.entries()).map(([key, imeis]) => {
      const [canonical_name, box_no] = key.split("|");
      const d = devices.find((x) => x.canonical_name === canonical_name);
      const display = (d?.device || d?.canonical_name || canonical_name).trim();

      // QR must contain only IMEI, one per line
      const qr_data = imeis.join("\n");
      const qty = imeis.length;

      return { device: display, canonical_name, box_no, qty, qr_data };
    });

    // Sort nicer: device then box
    labels.sort((a, b) => (a.canonical_name + a.box_no).localeCompare(b.canonical_name + b.box_no));

    const zpl_all = labels.map((l) => buildZplLabel(l.qr_data, l.device, l.box_no)).join("\n\n");

    return NextResponse.json({
      ok: true,
      mode: "preview",
      file_name: file.name,
      location,
      devices: new Set(labels.map((l) => l.canonical_name)).size,
      boxes: labels.length,
      items: labels.reduce((acc, l) => acc + l.qty, 0),
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}