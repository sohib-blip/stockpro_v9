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

function safeIncludes(v: any, needle: string) {
  return String(v ?? "").includes(needle);
}

function normalizeDevice(raw: any) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.split("-")[0].trim().toUpperCase();
}

function normalizeBox(v: any) {
  return String(v ?? "").trim();
}

function normalizeImei(v: any) {
  const s = String(v ?? "").trim();
  return s.replace(/\D/g, "");
}

function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}

function buildQrDataFromImeis(imeis: string[]) {
  const clean = (imeis || [])
    .map((x) => String(x ?? "").trim().replace(/\D/g, ""))
    .filter((x) => isLikelyImei(x));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const i of clean) {
    if (!seen.has(i)) {
      seen.add(i);
      unique.push(i);
    }
  }

  return unique.join("\n"); // ✅ IMEI only, one per line
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

function to2dArray(ws: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
}

function normHeader(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

type Group = {
  startCol: number;
  endCol: number;
  device: string;
  masterBoxCol: number; // BIG CARTON
  innerBoxCol: number;  // small box (ignored)
  imeiCol: number;
};

function detectGroups(rows: any[][]): { headerRowIdx: number; groups: Group[] } {
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] || [];
    const headers = row.map(normHeader);
    if (headers.some((h) => h === "imei" || safeIncludes(h, "imei"))) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) return { headerRowIdx: -1, groups: [] };

  const headerRow = rows[headerRowIdx] || [];
  const h = headerRow.map(normHeader);

  const imeiCols: number[] = [];
  for (let c = 0; c < h.length; c++) {
    if (h[c] === "imei" || safeIncludes(h[c], "imei")) imeiCols.push(c);
  }

  const groups: Group[] = [];

  for (const imeiCol of imeiCols) {
    const boxCandidates: number[] = [];
    for (let c = Math.max(0, imeiCol - 12); c <= imeiCol; c++) {
      if (h[c] === "box no." || h[c] === "box no" || safeIncludes(h[c], "box no")) {
        boxCandidates.push(c);
      }
    }
    if (boxCandidates.length < 2) continue;

    const masterBoxCol = boxCandidates[0];
    const innerBoxCol = boxCandidates[1];

    let startCol = masterBoxCol;
    let endCol = imeiCol;
    for (let c = imeiCol; c < h.length; c++) {
      const cell = h[c];
      if (!cell) {
        endCol = c - 1;
        break;
      }
      endCol = c;
    }

    const deviceTop = headerRowIdx > 0 ? normalizeDevice(rows[headerRowIdx - 1]?.[startCol]) : "";
    groups.push({ startCol, endCol, device: deviceTop, masterBoxCol, innerBoxCol, imeiCol });
  }

  const uniq: Group[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    const key = `${g.startCol}-${g.imeiCol}-${g.masterBoxCol}-${g.innerBoxCol}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(g);
    }
  }

  for (const g of uniq) {
    if (g.device) continue;
    for (let r = headerRowIdx + 1; r < Math.min(rows.length, headerRowIdx + 50); r++) {
      const v = rows[r]?.[g.masterBoxCol];
      const s = String(v ?? "").trim();
      if (s) {
        const d = normalizeDevice(s);
        if (d) {
          g.device = d;
          break;
        }
      }
    }
  }

  return { headerRowIdx, groups: uniq.filter((g) => !!g.device) };
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

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
    const rows = to2dArray(ws);

    if (!rows || rows.length < 2) return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });

    const { headerRowIdx, groups } = detectGroups(rows);
    if (headerRowIdx < 0 || groups.length === 0) {
      return NextResponse.json({ ok: false, error: "Could not detect device groups in file." }, { status: 400 });
    }

    // Parse IMEIs grouped by BIG CARTON
    const itemsParsed: Array<{ device: string; box_no: string; imei: string }> = [];
    const state = new Map<number, { master: string }>();
    for (const g of groups) state.set(g.startCol, { master: "" });

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      for (const g of groups) {
        const st = state.get(g.startCol)!;

        const masterRaw = row[g.masterBoxCol];
        const imeiRaw = row[g.imeiCol];

        const master = normalizeBox(masterRaw);
        const imei = normalizeImei(imeiRaw);

        if (master) st.master = master;
        if (!imei || !isLikelyImei(imei)) continue;

        const device = g.device || normalizeDevice(st.master) || "UNKNOWN";
        const bigBox = st.master;

        if (!device || device === "UNKNOWN" || !bigBox) continue;
        itemsParsed.push({ device, box_no: bigBox, imei });
      }
    }

    if (itemsParsed.length === 0) {
      return NextResponse.json({ ok: false, error: "No valid IMEI rows found." }, { status: 400 });
    }

    // Duplicate IMEI in file
    const seenImeis = new Map<string, number>();
    for (const it of itemsParsed) seenImeis.set(it.imei, (seenImeis.get(it.imei) ?? 0) + 1);

    const duplicatesInFile = Array.from(seenImeis.entries())
      .filter(([, n]) => n > 1)
      .map(([imei, count]) => ({ imei, count }));

    if (duplicatesInFile.length > 0) {
      return NextResponse.json(
        { ok: false, error: "Duplicate IMEI in file. Import aborted.", duplicates_in_file: duplicatesInFile.slice(0, 50) },
        { status: 400 }
      );
    }

    // Existing IMEI in DB
    const uniqueImeis = Array.from(seenImeis.keys());
    const existingImeis = new Set<string>();

    for (let i = 0; i < uniqueImeis.length; i += 500) {
      const chunk = uniqueImeis.slice(i, i + 500);
      const { data: exItems, error: exItemErr } = await supabase.from("items").select("imei").in("imei", chunk);
      if (exItemErr) return NextResponse.json({ ok: false, error: exItemErr.message }, { status: 500 });
      for (const it of exItems ?? []) existingImeis.add(String(it.imei));
    }

    if (existingImeis.size > 0) {
      return NextResponse.json(
        { ok: false, error: "Some IMEIs already exist. Import aborted.", existing_imeis: Array.from(existingImeis).slice(0, 50) },
        { status: 409 }
      );
    }

    // Group by device + big carton
    const byBox = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    for (const it of itemsParsed) {
      const key = `${it.device}__${it.box_no}`;
      const g = byBox.get(key) ?? { device: it.device, box_no: it.box_no, imeis: [] };
      g.imeis.push(it.imei);
      byBox.set(key, g);
    }

    const boxesArr = Array.from(byBox.values());
    const devicesSet = new Set<string>(boxesArr.map((b) => b.device));

    // Ensure devices exist
    try {
      const upsertDevices = Array.from(devicesSet).map((d) => ({ device: d }));
      if (upsertDevices.length > 0) await supabase.from("devices").upsert(upsertDevices, { onConflict: "device" });
    } catch {}

    // user
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;

    // inbound_imports (NO created_by_email)
    const { data: importRow, error: importErr } = await supabase
      .from("inbound_imports")
      .insert({
        file_name: file.name,
        devices_count: devicesSet.size,
        boxes_count: boxesArr.length,
        items_count: itemsParsed.length,
        location,
        ...(userId ? { created_by: userId } : {}),
        devices: Array.from(devicesSet),
      })
      .select("import_id")
      .single();

    if (importErr) return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });
    const import_id = importRow.import_id as string;

    // boxes table
    const allBoxNos = Array.from(new Set(boxesArr.map((b) => b.box_no)));
    const { data: existingBoxes, error: exErr } = await supabase.from("boxes").select("box_id, box_no, device").in("box_no", allBoxNos);
    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });

    const existingMap = new Map<string, any>();
    for (const b of existingBoxes ?? []) existingMap.set(`${b.device}__${b.box_no}`, b);

    const toInsertBoxes = boxesArr
      .filter((b) => !existingMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({ device: b.device, box_no: b.box_no, status: "IN", location }));

    if (toInsertBoxes.length > 0) {
      const { data: ins, error: insErr } = await supabase.from("boxes").insert(toInsertBoxes).select("box_id, box_no, device");
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      for (const b of ins ?? []) existingMap.set(`${b.device}__${b.box_no}`, b);
    }

    await supabase.from("boxes").update({ location }).in("box_no", allBoxNos);

    // items insert
    const itemsToInsert = itemsParsed.map((x) => {
      const box = existingMap.get(`${x.device}__${x.box_no}`);
      if (!box?.box_id) throw new Error(`Missing box_id for device=${x.device} box_no=${x.box_no}`);
      return { imei: x.imei, box_id: box.box_id, status: "IN" };
    });

    let insertedItems = 0;
    for (let i = 0; i < itemsToInsert.length; i += 1000) {
      const chunk = itemsToInsert.slice(i, i + 1000);
      const { error: insItemErr } = await supabase.from("items").insert(chunk);
      if (insItemErr) return NextResponse.json({ ok: false, error: insItemErr.message }, { status: 500 });
      insertedItems += chunk.length;
    }

    // inbound_import_boxes
    const importBoxesRows = boxesArr.map((b) => {
      const box = existingMap.get(`${b.device}__${b.box_no}`);
      if (!box?.box_id) throw new Error(`Missing box_id for import device=${b.device} box_no=${b.box_no}`);
      return { import_id, box_id: box.box_id, device: b.device, box_no: b.box_no, qty: b.imeis.length };
    });

    const { error: impBoxErr } = await supabase.from("inbound_import_boxes").insert(importBoxesRows);
    if (impBoxErr) return NextResponse.json({ ok: false, error: impBoxErr.message }, { status: 500 });

    // labels
    const labels = boxesArr.map((b) => {
      const device = String(b.device || "").trim();
      const box_no = String(b.box_no || "").trim();
      const qr_data = buildQrDataFromImeis(b.imeis);

      return {
        box_id: existingMap.get(`${device}__${box_no}`)?.box_id ?? "",
        device,
        box_no,
        qty: b.imeis.length,
        qr_data,
        imeis: b.imeis,
      };
    });

    const zpl_all = labels.map((l) => buildZpl({ qrData: String(l.qr_data || ""), device: String(l.device), boxNo: String(l.box_no) })).join("\n\n");

    return NextResponse.json({
      ok: true,
      import_id,
      file_name: file.name,
      location,
      boxes: boxesArr.length,
      devices: devicesSet.size,
      parsed_items: itemsParsed.length,
      inserted_items: insertedItems,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}