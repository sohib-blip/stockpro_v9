import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { detectSessionInUrl: false },
  });
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
  const m = s.match(/(\d{3}-\d{3})\s*$/);
  if (m) return m[1];
  const m2 = s.match(/(\d{3}-\d{3})/);
  return m2 ? m2[1] : null;
}

function extractRawDeviceFromBoxCell(boxCell: any): string | null {
  const s = String(boxCell ?? "").trim();
  if (!s) return null;
  const p = s.split("-")[0]?.trim(); // before first dash
  return p || null;
}

function detectHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const row = rows[r] || [];
    const cells = row.map(norm);
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) return r;
  }
  return -1;
}

/**
 * Detect repeated blocks (multi-device sheet)
 * ex: [Box No.] ... [IMEI] then again [Box No.] ... [IMEI] etc.
 */
function detectBlocks(header: string[]) {
  const blocks: { start: number; boxCol: number; imeiCol: number; deviceHintCol: number }[] = [];

  for (let c = 0; c < header.length; c++) {
    const h = header[c] || "";
    const isBox = h === "box no." || (h.includes("box") && h.includes("no"));
    if (!isBox) continue;

    let imeiCol = -1;
    for (let k = c; k <= Math.min(header.length - 1, c + 14); k++) {
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

type DeviceDbRow = { canonical_name: string; device: string | null; active?: boolean | null };

async function loadDevices(admin: ReturnType<typeof adminClient>) {
  const { data, error } = await admin!.from("devices").select("canonical_name, device, active");
  if (error) return [];
  return (data || []).map((d: DeviceDbRow) => ({
    canonical: String(d.canonical_name || ""),
    display: String(d.device || d.canonical_name || ""),
    active: d.active !== false,
  }));
}

/**
 * Smart match:
 * - exact canonical
 * - prefix canonical (raw startsWith db)
 * - prefix reverse (db startsWith raw)
 * - numeric padding: FMC03 -> FMC003, FMC9202 -> FMC920 (if exists)
 */
function resolveDeviceDisplay(rawDevice: string, deviceList: { canonical: string; display: string; active: boolean }[]) {
  const rawCanon = canonicalize(rawDevice);
  if (!rawCanon) return null;

  const activeList = deviceList.filter((d) => d.active);

  const score = (dbCanon: string) => {
    if (!dbCanon) return -1;
    if (rawCanon === dbCanon) return 1000;
    if (rawCanon.startsWith(dbCanon)) return 900 + dbCanon.length; // longer prefix wins
    if (dbCanon.startsWith(rawCanon)) return 700 + rawCanon.length;

    // numeric padding heuristic
    // split into letters + digits end
    const m = rawCanon.match(/^([A-Z]+)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const num = m[2];
      const n = parseInt(num, 10);

      // try pad to 3
      const pad3 = prefix + String(n).padStart(3, "0");
      if (pad3 === dbCanon) return 850;

      // try trim to 3 digits (example: FMC9202 -> FMC920)
      const trim3 = prefix + String(num).slice(0, 3);
      if (trim3 === dbCanon) return 840;

      // try pad to 4 (rare)
      const pad4 = prefix + String(n).padStart(4, "0");
      if (pad4 === dbCanon) return 830;
    }

    return -1;
  };

  let best: { canonical: string; display: string } | null = null;
  let bestScore = -1;

  for (const d of activeList) {
    const s = score(d.canonical);
    if (s > bestScore) {
      bestScore = s;
      best = { canonical: d.canonical, display: d.display };
    }
  }

  return best ? best.display : null;
}

type ParsedLabel = {
  device: string;
  box_no: string; // master box no
  qty: number;
  qr_data: string; // imeis only, one per line
  imeis: string[];
};

export async function POST(req: Request) {
  try {
    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // Validate user session (security gate)
    const userClient = authedClient(token);
    const { error: uErr } = await userClient.auth.getUser();
    if (uErr) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

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
      return NextResponse.json({ ok: false, error: "Could not detect header row (need BOX + IMEI headers)" }, { status: 400 });
    }

    const header = (rows[headerRowIdx] || []).map(norm);
    const blocks = detectBlocks(header);
    if (!blocks.length) {
      return NextResponse.json(
        { ok: false, error: "No blocks detected. Expected repeated 'Box No.' + 'IMEI' sections." },
        { status: 400 }
      );
    }

    const devicesDb = await loadDevices(admin);

    // Parse all blocks → group by (device, masterBox)
    const byKey = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    const unknown = new Set<string>();

    for (const block of blocks) {
      const row1 = rows[0] || [];
      const deviceHintRaw = String(row1[block.deviceHintCol] ?? "").trim();

      let currentDeviceRaw: string | null = deviceHintRaw || null;
      let currentDeviceDisplay: string | null = currentDeviceRaw ? resolveDeviceDisplay(currentDeviceRaw, devicesDb) : null;

      if (currentDeviceRaw && !currentDeviceDisplay) unknown.add(currentDeviceRaw);

      let currentMasterBox: string | null = null;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const boxCell = row[block.boxCol];
        const imeiCell = row[block.imeiCol];

        if (boxCell !== null && boxCell !== undefined && String(boxCell).trim() !== "") {
          const rawDev = extractRawDeviceFromBoxCell(boxCell);
          const mb = extractMasterBoxNo(boxCell);

          if (rawDev) {
            currentDeviceRaw = rawDev;
            const resolved = resolveDeviceDisplay(rawDev, devicesDb);
            if (!resolved) unknown.add(rawDev);
            currentDeviceDisplay = resolved || currentDeviceDisplay;
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

    // ✅ If any unknown device → block preview with list (you wanted this)
    if (unknown.size > 0) {
      const list = Array.from(unknown).sort();
      return NextResponse.json(
        {
          ok: false,
          error: "Unknown devices found in Excel. Add them in Admin > Devices, then retry.",
          unknown_devices: list,
        },
        { status: 400 }
      );
    }

    const labels: ParsedLabel[] = Array.from(byKey.values())
      .map((x) => {
        const uniq = Array.from(new Set(x.imeis));
        return {
          device: x.device,
          box_no: x.box_no,
          qty: uniq.length,
          imeis: uniq,
          qr_data: uniq.join("\n"), // ✅ IMEI only, one per line
        };
      })
      .filter((l) => l.qty > 0)
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json({ ok: false, error: "No valid rows parsed. Check that IMEI cells contain 15 digits." }, { status: 400 });
    }

    const devicesDetected = new Set(labels.map((l) => l.device)).size;

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: devicesDetected,
      boxes: labels.length,
      items: labels.reduce((acc, l) => acc + l.qty, 0),
      labels: labels.map((l) => ({ device: l.device, box_no: l.box_no, qty: l.qty, qr_data: l.qr_data })),
      debug: {
        header_row_index: headerRowIdx,
        blocks_detected: blocks.map((b) => ({ start: b.start, boxCol: b.boxCol, imeiCol: b.imeiCol })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}