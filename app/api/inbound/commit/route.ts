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

const s = (v: any) => String(v ?? "").trim();
const norm = (v: any) => s(v).toLowerCase();

function cleanImei(v: any) {
  return s(v).replace(/\D/g, "");
}
function isImei(v: string) {
  return /^\d{14,17}$/.test(v);
}

function buildQrDataFromImeis(imeis: string[]) {
  const clean = imeis.map(cleanImei).filter(isImei);
  return Array.from(new Set(clean)).join("\n"); // ✅ IMEI-only, 1 per line
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

async function loadDevices(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.from("devices").select("device");
  if (error) return [];
  return (data || [])
    .map((r: any) => s(r.device))
    .filter(Boolean)
    .sort((a: string, b: string) => b.length - a.length); // longest first
}

/**
 * Example box cell: "FMB140BTZ9FD-076-004"
 * - device prefix should match existing devices like "FMB140"
 * - boxNo = "076-004" (last two hyphen parts)
 */
function parseBoxCell(boxCellRaw: string, devicesSorted: string[]) {
  const raw = s(boxCellRaw);
  if (!raw) return { device: null as string | null, boxNo: "" };

  const upper = raw.toUpperCase();

  // ✅ match device by prefix with existing devices
  let device: string | null = null;
  for (const d of devicesSorted) {
    const du = d.toUpperCase();
    if (du && upper.startsWith(du)) {
      device = d;
      break;
    }
  }

  // ✅ boxNo = last 2 parts after "-"
  const parts = raw.split("-").map((p) => p.trim()).filter(Boolean);

  // If we have at least 3 parts, example: [FMB140BTZ9FD, 076, 004] -> "076-004"
  let boxNo = "";
  if (parts.length >= 3) {
    boxNo = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
  } else if (parts.length === 2) {
    // fallback: [something, 076] -> "076"
    boxNo = parts[1];
  } else {
    // no "-" found, no boxno
    boxNo = "";
  }

  return { device, boxNo };
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const locationRaw = s(form.get("location") || "00");
    const location =
      locationRaw === "00" || locationRaw === "1" || locationRaw === "6" || locationRaw === "Cabinet"
        ? locationRaw
        : "00";

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows || rows.length < 2) return NextResponse.json({ ok: false, error: "Empty Excel" }, { status: 400 });

    // header row detection (safe)
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(30, rows.length); r++) {
      const row = rows[r] || [];
      const cells = row.map((c) => norm(c));
      const hasImei = cells.some((c) => c.includes("imei") || c.includes("serial"));
      const hasBox = cells.some((c) => c.includes("box"));
      if (hasImei && hasBox) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx < 0) {
      return NextResponse.json({ ok: false, error: "Header not detected (need IMEI + BOX columns)" }, { status: 400 });
    }

    const header = (rows[headerRowIdx] || []).map((c) => norm(c));
    const imeiCol = header.findIndex((h) => h.includes("imei") || h.includes("serial"));
    const boxCol = header.findIndex((h) => h.includes("box"));

    if (imeiCol < 0 || boxCol < 0) {
      return NextResponse.json({ ok: false, error: "Missing required columns (IMEI/BOX)" }, { status: 400 });
    }

    const devicesSorted = await loadDevices(supabase);

    // parse all rows
    const parsed: Array<{ device: string; box_no: string; imei: string }> = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const imei = cleanImei(row[imeiCol]);
      if (!isImei(imei)) continue;

      const boxCell = s(row[boxCol]);
      const { device, boxNo } = parseBoxCell(boxCell, devicesSorted);

      if (!device || !boxNo) continue;

      parsed.push({ device, box_no: boxNo, imei });
    }

    if (!parsed.length) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Expected Box No like: FMB140xxxx-076-004 + valid IMEI." },
        { status: 400 }
      );
    }

    // group by device + box
    const byBox = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    for (const p of parsed) {
      const key = `${p.device}__${p.box_no}`;
      const g = byBox.get(key) ?? { device: p.device, box_no: p.box_no, imeis: [] };
      g.imeis.push(p.imei);
      byBox.set(key, g);
    }
    const boxesArr = Array.from(byBox.values());

    // ensure devices exist
    await supabase
      .from("devices")
      .upsert(Array.from(new Set(boxesArr.map((b) => b.device))).map((d) => ({ device: d })), { onConflict: "device" });

    // inbound history (only safe cols)
    const { error: histErr } = await supabase.from("inbound_imports").insert({
      file_name: file.name,
      location,
      devices_count: new Set(boxesArr.map((b) => b.device)).size,
      boxes_count: boxesArr.length,
      items_count: parsed.length,
    });
    if (histErr) return NextResponse.json({ ok: false, error: histErr.message }, { status: 500 });

    // boxes upsert
    const { data: existingBoxes, error: exBoxErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_no", Array.from(new Set(boxesArr.map((b) => b.box_no))));

    if (exBoxErr) return NextResponse.json({ ok: false, error: exBoxErr.message }, { status: 500 });

    const boxMap = new Map<string, any>();
    for (const b of existingBoxes || []) boxMap.set(`${s(b.device)}__${s(b.box_no)}`, b);

    const toInsert = boxesArr
      .filter((b) => !boxMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({ device: b.device, box_no: b.box_no, status: "IN", location }));

    if (toInsert.length) {
      const { data: ins, error: insErr } = await supabase
        .from("boxes")
        .insert(toInsert)
        .select("box_id, box_no, device");
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      for (const b of ins || []) boxMap.set(`${s(b.device)}__${s(b.box_no)}`, b);
    }

    await supabase.from("boxes").update({ location }).in("box_no", Array.from(new Set(boxesArr.map((b) => b.box_no))));

    // prevent duplicate IMEI in DB
    const imeisAll = parsed.map((p) => p.imei);
    const { data: existingItems, error: exItemErr } = await supabase.from("items").select("imei").in("imei", imeisAll);
    if (exItemErr) return NextResponse.json({ ok: false, error: exItemErr.message }, { status: 500 });
    const exists = new Set((existingItems || []).map((x: any) => s(x.imei)));
    if (exists.size > 0) {
      return NextResponse.json(
        { ok: false, error: "Some IMEIs already exist in DB. Import aborted.", existing_imeis: Array.from(exists).slice(0, 50) },
        { status: 409 }
      );
    }

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

    // labels
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