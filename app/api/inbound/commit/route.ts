import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/** ---------- Clients ---------- */
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

/** ---------- Utils ---------- */
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
function parseBoxCell(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(.*?)-(\d{2,4})-(\d{2,4})$/);
  if (!m) return null;
  const deviceRaw = String(m[1] ?? "").trim();
  const boxNo = `${m[2]}-${m[3]}`;
  return { deviceRaw, boxNo, full: s };
}
function pickBestDevice(devices: Array<{ canonical_name: string; device?: string | null }>, deviceRaw: string) {
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

function detectBlocks(header: string[]) {
  const imeiCols: number[] = [];
  for (let i = 0; i < header.length; i++) {
    if (header[i]?.includes("imei")) imeiCols.push(i);
  }

  const blocks = imeiCols.map((imeiCol) => {
    let left = imeiCol;
    while (left >= 0) {
      const h = header[left] || "";
      if (h.includes("box") && h.includes("no")) break;
      left--;
    }
    if (left < 0) return { imeiCol, boxCol: null as number | null };

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

async function parseSupplierExcel(file: File, admin: any) {
  const devRes = await admin.from("devices").select("canonical_name, device, active").eq("active", true);
  if (devRes.error) throw new Error(devRes.error.message);
  const devices = (devRes.data || []) as Array<{ canonical_name: string; device?: string | null }>;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
  if (!rows || rows.length === 0) throw new Error("Empty excel file");

  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx < 0) throw new Error("Could not detect header row (need BOX + IMEI)");

  const header = (rows[headerRowIdx] || []).map((x) => norm(x));
  const blocks = detectBlocks(header);
  if (!blocks.length) throw new Error("Missing required columns (Box No + IMEI)");

  const lastBoxByBlock: Record<string, any> = {};
  const imeisByKey = new Map<string, string[]>();

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

  if (!imeisByKey.size) throw new Error("No valid rows parsed. Check Box No + IMEI columns.");

  const labels = Array.from(imeisByKey.entries()).map(([key, imeis]) => {
    const [canonical_name, box_no] = key.split("|");
    const d = devices.find((x) => x.canonical_name === canonical_name);
    const display = (d?.device || d?.canonical_name || canonical_name).trim();
    const qr_data = imeis.join("\n");
    return { canonical_name, device: display, box_no, qty: imeis.length, imeis, qr_data };
  });

  labels.sort((a, b) => (a.canonical_name + a.box_no).localeCompare(b.canonical_name + b.box_no));
  const zpl_all = labels.map((l) => buildZplLabel(l.qr_data, l.device, l.box_no)).join("\n\n");

  return { labels, zpl_all };
}

/** ---------- COMMIT ---------- */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    const admin = adminClient();
    if (!admin) return NextResponse.json({ ok: false, error: "Missing service role key" }, { status: 500 });

    const supa = authedClient(token);
    const { data: u } = await supa.auth.getUser();
    const email = u.user?.email || null;

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") ?? "00");

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // 🔒 secure: parse again server-side
    const parsed = await parseSupplierExcel(file, admin);

    // ---- upsert boxes + insert items
    // NOTE: assumes your schema:
    // boxes: box_id(uuid), device(text), box_no(text), location(text), status(text), qr_data(text)
    // items: item_id(uuid), imei(text unique), box_id(uuid), status(text), created_at
    let insertedItems = 0;
    let insertedBoxes = 0;

    for (const l of parsed.labels) {
      // find existing box
      const existing = await admin
        .from("boxes")
        .select("box_id")
        .eq("device", l.device)
        .eq("box_no", l.box_no)
        .maybeSingle();

      let box_id = existing.data?.box_id as string | undefined;

      if (!box_id) {
        const ins = await admin
          .from("boxes")
          .insert({
            device: l.device,
            box_no: l.box_no,
            location,
            status: "IN_STOCK",
            qr_data: l.qr_data,
          })
          .select("box_id")
          .single();

        if (ins.error) throw new Error(ins.error.message);
        box_id = ins.data.box_id;
        insertedBoxes++;
      } else {
        // keep qr_data updated
        await admin.from("boxes").update({ location, qr_data: l.qr_data }).eq("box_id", box_id);
      }

      // chunk insert imeis
      const chunkSize = 500;
      for (let i = 0; i < l.imeis.length; i += chunkSize) {
        const chunk = l.imeis.slice(i, i + chunkSize);
        const payload = chunk.map((imei) => ({
          imei,
          box_id,
          status: "IN",
        }));

        const up = await admin.from("items").upsert(payload, { onConflict: "imei", ignoreDuplicates: true });
        if (up.error) throw new Error(up.error.message);
        insertedItems += chunk.length;
      }
    }

    // optional log table (ignore if missing)
    try {
      await admin.from("inbound_imports_log").insert({
        file_name: file.name,
        location,
        created_by_email: email,
        boxes_count: parsed.labels.length,
        items_count: parsed.labels.reduce((a, x) => a + x.qty, 0),
        devices: Array.from(new Set(parsed.labels.map((x) => x.device))),
      } as any);
    } catch {}

    return NextResponse.json({
      ok: true,
      mode: "commit",
      file_name: file.name,
      location,
      devices: new Set(parsed.labels.map((l) => l.device)).size,
      boxes: parsed.labels.length,
      items: parsed.labels.reduce((acc, l) => acc + l.qty, 0),
      inserted_boxes: insertedBoxes,
      inserted_items: insertedItems,
      labels: parsed.labels.map((x) => ({ device: x.device, box_no: x.box_no, qty: x.qty, qr_data: x.qr_data })),
      zpl_all: parsed.zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}