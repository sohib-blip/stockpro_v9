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

const S = (v: any) => String(v ?? "");
const T = (v: any) => String(v ?? "").trim();

/**
 * ✅ Never call .includes directly on unknown values.
 * This avoids: "Cannot read properties of undefined (reading 'includes')"
 */
function safeIncludes(value: any, search: string) {
  return String(value ?? "").toLowerCase().includes(search.toLowerCase());
}

function normalizeImei(v: any) {
  return T(v).replace(/\D/g, "");
}
function isLikelyImei(x: string) {
  return /^\d{14,17}$/.test(x);
}

// normalize for matching: remove non-alnum (so "FMB 140" => "FMB140")
function normKey(v: any) {
  return T(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function loadDevices(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.from("devices").select("device");
  if (error) return [];
  return (data || [])
    .map((r: any) => T(r.device))
    .filter(Boolean)
    .sort((a: string, b: string) => b.length - a.length); // longest first
}

/**
 * Match a DB device (ex: "FMB 140") to supplier text (ex: "FMB140BTZ9FD-076-004")
 * by normalizing both: remove spaces/symbols => "FMB140"
 */
function matchDeviceFromText(text: string, devicesSorted: string[]) {
  const cell = normKey(text);
  for (const d of devicesSorted) {
    const dk = normKey(d);
    if (!dk) continue;
    const idx = cell.indexOf(dk);
    if (idx === 0 || idx === 1 || idx === 2) return d; // keep DB original
  }
  return null;
}

/**
 * Extract BoxNR from master box string:
 * Example: "FMB140BTZ9FD-076-004" => "076-004"
 * Also supports different separators.
 */
function extractBoxNo(masterBoxCell: string) {
  const raw = T(masterBoxCell);
  if (!raw) return "";

  // at end: 076-004 or 076–004
  const m1 = raw.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*$/);
  if (m1) return `${m1[1]}-${m1[2]}`;

  // fallback: last two numeric blocks
  const nums = raw.match(/\d{2,4}/g) || [];
  if (nums.length >= 2) return `${nums[nums.length - 2]}-${nums[nums.length - 1]}`;

  return "";
}

function buildQrDataFromImeis(imeis: string[]) {
  const clean = imeis.map(normalizeImei).filter((x) => isLikelyImei(x));
  return Array.from(new Set(clean)).join("\n"); // ✅ IMEI only, one per line
}

function buildZpl({
  qrData,
  device,
  boxNo,
}: {
  qrData: string;
  device: string;
  boxNo: string;
}) {
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

type Group = {
  startCol: number;
  masterBoxCol: number; // first "Box No."
  innerBoxCol: number;  // second "Box No." (ignored)
  imeiCol: number;
  deviceHint: string;   // from row above header
};

/**
 * Detect repeated blocks placed side-by-side:
 * Each block contains headers like "Box No." and "IMEI"
 * There are multiple IMEI columns (one per block/device)
 */
function detectGroups(rows: any[][]): { headerRowIdx: number; groups: Group[] } {
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(40, rows.length); r++) {
    const row = rows[r] || [];
    const hasImei = row.some((c: any) => safeIncludes(c, "imei") || safeIncludes(c, "serial"));
    const hasBox = row.some((c: any) => safeIncludes(c, "box"));
    if (hasImei && hasBox) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) return { headerRowIdx: -1, groups: [] };

  const headerRow = rows[headerRowIdx] || [];
  const header = headerRow.map((c: any) => String(c ?? "").toLowerCase().replace(/\s+/g, " ").trim());
  const deviceRow = headerRowIdx > 0 ? rows[headerRowIdx - 1] || [] : [];

  const imeiCols: number[] = [];
  for (let c = 0; c < header.length; c++) {
    if (safeIncludes(header[c], "imei")) imeiCols.push(c);
  }

  const groups: Group[] = [];

  for (const imeiCol of imeiCols) {
    // find two "box no" columns to the left (master + inner)
    const boxCols: number[] = [];
    for (let c = Math.max(0, imeiCol - 15); c <= imeiCol; c++) {
      if (safeIncludes(header[c], "box no")) boxCols.push(c);
    }
    if (boxCols.length < 1) continue;

    // Some files have only one Box No; we treat it as master
    const masterBoxCol = boxCols[0];
    const innerBoxCol = boxCols.length >= 2 ? boxCols[1] : boxCols[0];

    const deviceHint = T(deviceRow[masterBoxCol]);

    groups.push({
      startCol: masterBoxCol,
      masterBoxCol,
      innerBoxCol,
      imeiCol,
      deviceHint,
    });
  }

  // de-dupe
  const seen = new Set<string>();
  const uniq: Group[] = [];
  for (const g of groups) {
    const k = `${g.masterBoxCol}-${g.imeiCol}-${g.innerBoxCol}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(g);
    }
  }

  return { headerRowIdx, groups: uniq };
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;

    const locationRaw = T(form.get("location") || "00");
    const location =
      locationRaw === "00" || locationRaw === "1" || locationRaw === "6" || locationRaw === "Cabinet"
        ? locationRaw
        : "00";

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });

    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows || rows.length < 3) {
      return NextResponse.json({ ok: false, error: "Empty Excel" }, { status: 400 });
    }

    const { headerRowIdx, groups } = detectGroups(rows);
    if (headerRowIdx < 0 || groups.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect blocks (need headers containing IMEI and Box No)" },
        { status: 400 }
      );
    }

    const devicesSorted = await loadDevices(supabase);
    if (devicesSorted.length === 0) {
      return NextResponse.json({ ok: false, error: "Devices table is empty" }, { status: 400 });
    }

    // Carry master box per group (because master box often appears once, then blank)
    const state = new Map<number, { masterBoxCell: string }>();
    for (const g of groups) state.set(g.startCol, { masterBoxCell: "" });

    const parsed: Array<{ device: string; box_no: string; imei: string }> = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      for (const g of groups) {
        const st = state.get(g.startCol)!;

        const masterCell = T(row[g.masterBoxCol]);
        if (masterCell) st.masterBoxCell = masterCell;

        const imei = normalizeImei(row[g.imeiCol]);
        if (!isLikelyImei(imei)) continue;

        const master = st.masterBoxCell;
        if (!master) continue;

        const hint = g.deviceHint || master;
        const device =
          matchDeviceFromText(hint, devicesSorted) ||
          matchDeviceFromText(master, devicesSorted);

        if (!device) continue;

        const box_no = extractBoxNo(master);
        if (!box_no) continue;

        parsed.push({ device, box_no, imei });
      }
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No valid rows parsed. Check that master Box No looks like FMB...-076-004 and that IMEI cells contain 14-17 digits.",
        },
        { status: 400 }
      );
    }

    // Group by device + box_no
    const byBox = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    for (const p of parsed) {
      const key = `${p.device}__${p.box_no}`;
      const g = byBox.get(key) ?? { device: p.device, box_no: p.box_no, imeis: [] };
      g.imeis.push(p.imei);
      byBox.set(key, g);
    }
    const boxesArr = Array.from(byBox.values());

    // Insert inbound import history (only safe columns)
    const { error: histErr } = await supabase.from("inbound_imports").insert({
      file_name: file.name,
      location,
      devices_count: new Set(boxesArr.map((b) => b.device)).size,
      boxes_count: boxesArr.length,
      items_count: parsed.length,
    });
    if (histErr) return NextResponse.json({ ok: false, error: histErr.message }, { status: 500 });

    // Check duplicates in DB
    const imeisAll = Array.from(new Set(parsed.map((p) => p.imei)));
    const { data: existingItems, error: exItemErr } = await supabase.from("items").select("imei").in("imei", imeisAll);
    if (exItemErr) return NextResponse.json({ ok: false, error: exItemErr.message }, { status: 500 });

    const exists = new Set((existingItems || []).map((x: any) => String(x.imei)));
    if (exists.size > 0) {
      return NextResponse.json(
        { ok: false, error: "Some IMEIs already exist in DB. Import aborted.", existing_imeis: Array.from(exists).slice(0, 50) },
        { status: 409 }
      );
    }

    // Upsert boxes (device + box_no)
    const uniqueBoxNos = Array.from(new Set(boxesArr.map((b) => b.box_no)));

    const { data: existingBoxes, error: exBoxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_no", uniqueBoxNos);

    if (exBoxErr) return NextResponse.json({ ok: false, error: exBoxErr.message }, { status: 500 });

    const boxMap = new Map<string, any>();
    for (const b of existingBoxes || []) {
      boxMap.set(`${String(b.device)}__${String(b.box_no)}`, b);
    }

    const toInsertBoxes = boxesArr
      .filter((b) => !boxMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({ device: b.device, box_no: b.box_no, status: "IN", location }));

    if (toInsertBoxes.length > 0) {
      const { data: ins, error: insErr } = await supabase
        .from("boxes")
        .insert(toInsertBoxes)
        .select("box_id, box_no, device");
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      for (const b of ins || []) {
        boxMap.set(`${String(b.device)}__${String(b.box_no)}`, b);
      }
    }

    await supabase.from("boxes").update({ location }).in("box_no", uniqueBoxNos);

    // Insert items
    const itemsToInsert = parsed.map((p) => {
      const box = boxMap.get(`${p.device}__${p.box_no}`);
      if (!box?.box_id) throw new Error(`Missing box_id for ${p.device} ${p.box_no}`);
      return { imei: p.imei, box_id: box.box_id, status: "IN" };
    });

    for (let i = 0; i < itemsToInsert.length; i += 1000) {
      const chunk = itemsToInsert.slice(i, i + 1000);
      const { error } = await supabase.from("items").insert(chunk);
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // Labels + ZPL
    const labels = boxesArr.map((b) => {
      const qr_data = buildQrDataFromImeis(b.imeis);
      return { device: b.device, box_no: b.box_no, qty: b.imeis.length, qr_data };
    });

    const zpl_all = labels
      .map((l) => buildZpl({ qrData: l.qr_data, device: l.device, boxNo: l.box_no }))
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      location,
      devices: new Set(boxesArr.map((b) => b.device)).size,
      boxes: boxesArr.length,
      items: parsed.length,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}