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
const norm = (v: any) => S(v).toLowerCase().trim();

function normalizeImei(v: any) {
  return S(v).trim().replace(/\D/g, "");
}
function isLikelyImei(x: string) {
  return /^\d{14,17}$/.test(x);
}

// normalize for matching: remove non-alnum (so "FMB 140" => "FMB140")
function normKey(v: any) {
  return S(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function loadDevices(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.from("devices").select("device");
  if (error) return [];
  return (data || [])
    .map((r: any) => String(r.device ?? "").trim())
    .filter(Boolean)
    .sort((a: string, b: string) => b.length - a.length); // longest first
}

function matchDeviceFromText(text: string, devicesSorted: string[]) {
  const cell = normKey(text);
  for (const d of devicesSorted) {
    const dk = normKey(d);
    if (!dk) continue;
    // allow start match, or near-start match (sometimes there is a prefix)
    const idx = cell.indexOf(dk);
    if (idx === 0 || idx === 1 || idx === 2) return d; // keep DB original (ex: "FMB 140")
  }
  return null;
}

function extractBoxNo(masterBoxCell: string) {
  // wants last two numeric blocks at end -> "076-004"
  const raw = S(masterBoxCell).trim();
  if (!raw) return "";

  // support hyphen OR en-dash at end: 076-004 / 076–004
  const m1 = raw.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*$/);
  if (m1) return `${m1[1]}-${m1[2]}`;

  // fallback: last two numeric blocks anywhere
  const nums = raw.match(/\d{2,4}/g) || [];
  if (nums.length >= 2) return `${nums[nums.length - 2]}-${nums[nums.length - 1]}`;

  return "";
}

function buildQrDataFromImeis(imeis: string[]) {
  const clean = imeis.map(normalizeImei).filter((x) => isLikelyImei(x));
  const uniq = Array.from(new Set(clean));
  return uniq.join("\n"); // ✅ IMEI only, one per line
}

function buildZpl({ qrData, device, boxNo }: { qrData: string; device: string; boxNo: string }) {
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
  deviceHint: string;   // comes from row above header
};

function detectGroups(rows: any[][]) {
  // In your file:
  // Row 1 = device hints (FMB140BTZ9FD, FMC234WC5XWU, ...)
  // Row 2 = header repeated blocks
  // We'll find the row that contains "IMEI" and "Box No."
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const row = rows[r] || [];
    const cells = row.map((c) => norm(c));
    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    if (hasImei && hasBox) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) return { headerRowIdx: -1, groups: [] as Group[] };

  const header = (rows[headerRowIdx] || []).map((c) => norm(c));
  const deviceRow = headerRowIdx > 0 ? rows[headerRowIdx - 1] || [] : [];

  // find all IMEI columns
  const imeiCols: number[] = [];
  for (let c = 0; c < header.length; c++) {
    if (header[c] === "imei" || header[c].includes("imei")) imeiCols.push(c);
  }

  const groups: Group[] = [];

  for (const imeiCol of imeiCols) {
    // find 2 "box no" to the left within a window
    const boxCols: number[] = [];
    for (let c = Math.max(0, imeiCol - 12); c <= imeiCol; c++) {
      const h = header[c];
      if (h === "box no." || h === "box no" || h.includes("box no")) boxCols.push(c);
    }
    if (boxCols.length < 2) continue;

    const masterBoxCol = boxCols[0];
    const innerBoxCol = boxCols[1];

    const deviceHint = String(deviceRow[masterBoxCol] ?? "").trim();

    groups.push({
      startCol: masterBoxCol,
      masterBoxCol,
      innerBoxCol,
      imeiCol,
      deviceHint,
    });
  }

  // de-dupe groups
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

    const locationRaw = String(form.get("location") || "00").trim();
    const location =
      locationRaw === "00" || locationRaw === "1" || locationRaw === "6" || locationRaw === "Cabinet"
        ? locationRaw
        : "00";

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows || rows.length < 3) {
      return NextResponse.json({ ok: false, error: "Empty Excel" }, { status: 400 });
    }

    const { headerRowIdx, groups } = detectGroups(rows);
    if (headerRowIdx < 0 || groups.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect repeated device blocks (need IMEI + Box No headers)." },
        { status: 400 }
      );
    }

    const devicesSorted = await loadDevices(supabase);
    if (devicesSorted.length === 0) {
      return NextResponse.json({ ok: false, error: "No devices found in DB (devices table empty)." }, { status: 400 });
    }

    // carry master box per group (because in your file, master box only appears once, then blanks)
    const state = new Map<number, { masterBoxCell: string }>();
    for (const g of groups) state.set(g.startCol, { masterBoxCell: "" });

    const parsed: Array<{ device: string; box_no: string; imei: string }> = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];

      for (const g of groups) {
        const st = state.get(g.startCol)!;

        const masterCell = String(row[g.masterBoxCol] ?? "").trim();
        if (masterCell) st.masterBoxCell = masterCell;

        const imei = normalizeImei(row[g.imeiCol]);
        if (!isLikelyImei(imei)) continue;

        const master = st.masterBoxCell; // last known master
        if (!master) continue;

        // device match: prefer device hint from top row if present, else master cell
        const hint = g.deviceHint || master;
        const device = matchDeviceFromText(hint, devicesSorted) || matchDeviceFromText(master, devicesSorted);
        if (!device) continue;

        const box_no = extractBoxNo(master);
        if (!box_no) continue;

        parsed.push({ device, box_no, imei });
      }
    }

    if (parsed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Your Excel is multi-block; ensure master Box No like FMB...-076-004 exists and IMEI cells are valid." },
        { status: 400 }
      );
    }

    // group by device + box_no
    const byBox = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    for (const p of parsed) {
      const key = `${p.device}__${p.box_no}`;
      const g = byBox.get(key) ?? { device: p.device, box_no: p.box_no, imeis: [] };
      g.imeis.push(p.imei);
      byBox.set(key, g);
    }
    const boxesArr = Array.from(byBox.values());

    // history insert (only safe cols)
    const { error: histErr } = await supabase.from("inbound_imports").insert({
      file_name: file.name,
      location,
      devices_count: new Set(boxesArr.map((b) => b.device)).size,
      boxes_count: boxesArr.length,
      items_count: parsed.length,
    });
    if (histErr) return NextResponse.json({ ok: false, error: histErr.message }, { status: 500 });

    // check IMEI duplicates in DB
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

    // upsert boxes (by device+box_no)
    // NOTE: your table likely doesn't have unique constraint on (device, box_no).
    // We'll fetch by box_no then map by device+box_no.
    const uniqueBoxNos = Array.from(new Set(boxesArr.map((b) => b.box_no)));

    const { data: existingBoxes, error: exBoxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_no", uniqueBoxNos);

    if (exBoxErr) return NextResponse.json({ ok: false, error: exBoxErr.message }, { status: 500 });

    const boxMap = new Map<string, any>();
    for (const b of existingBoxes || []) boxMap.set(`${String(b.device)}__${String(b.box_no)}`, b);

    const toInsertBoxes = boxesArr
      .filter((b) => !boxMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({ device: b.device, box_no: b.box_no, status: "IN", location }));

    if (toInsertBoxes.length > 0) {
      const { data: ins, error: insErr } = await supabase
        .from("boxes")
        .insert(toInsertBoxes)
        .select("box_id, box_no, device");

      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      for (const b of ins || []) boxMap.set(`${String(b.device)}__${String(b.box_no)}`, b);
    }

    await supabase.from("boxes").update({ location }).in("box_no", uniqueBoxNos);

    // insert items
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

    // labels + zpl
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