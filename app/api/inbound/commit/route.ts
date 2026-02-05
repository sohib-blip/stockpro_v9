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
  const digits = s.replace(/\D/g, "");
  return digits;
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

  // QR = IMEIs only, one per line
  return unique.join("\n");
}

function buildZpl({ qrData, device, boxNo }: { qrData: string; device: string; boxNo: string }) {
  // Zebra ZD220
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
  masterBoxCol: number; // first "Box No." = BIG CARTON
  innerBoxCol: number;  // second "Box No." = small boxes
  imeiCol: number;      // "IMEI"
};

function detectGroups(rows: any[][]): { headerRowIdx: number; groups: Group[] } {
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] || [];
    const headers = row.map(normHeader);
    if (headers.some((h) => h === "imei" || h.includes("imei"))) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx < 0) return { headerRowIdx: -1, groups: [] };

  const headerRow = rows[headerRowIdx] || [];
  const h = headerRow.map(normHeader);

  const imeiCols: number[] = [];
  for (let c = 0; c < h.length; c++) {
    if (h[c] === "imei" || h[c].includes("imei")) imeiCols.push(c);
  }

  const groups: Group[] = [];

  for (const imeiCol of imeiCols) {
    const boxCandidates: number[] = [];
    for (let c = Math.max(0, imeiCol - 12); c <= imeiCol; c++) {
      if (h[c] === "box no." || h[c] === "box no" || h[c].includes("box no")) boxCandidates.push(c);
    }
    if (boxCandidates.length < 2) continue;

    const masterBoxCol = boxCandidates[0]; // ✅ BIG CARTON
    const innerBoxCol = boxCandidates[1];  // small box

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
    const device = deviceTop;

    groups.push({ startCol, endCol, device, masterBoxCol, innerBoxCol, imeiCol });
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
    const location = locationRaw === "00" || locationRaw === "1" || locationRaw === "6" || locationRaw === "Cabinet" ? locationRaw : "00";

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = to2dArray(ws);

    if (!rows || rows.length < 2) return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });

    const { headerRowIdx, groups } = detectGroups(rows);

    if (headerRowIdx < 0 || groups.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect groups (multi-device blocks). Check the file format." },
        { status: 400 }
      );
    }

    // ✅ Now we parse using BIG CARTON as box_no
    // We still capture small box as "inner_box_no" (stored only in response + optional history string)
    const itemsParsed: Array<{ device: string; box_no: string; inner_box_no: string; imei: string }> = [];

    const state = new Map<number, { master: string; inner: string }>();
    for (const g of groups) state.set(g.startCol, { master: "", inner: "" });

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      for (const g of groups) {
        const st = state.get(g.startCol)!;

        const masterRaw = row[g.masterBoxCol]; // BIG CARTON
        const innerRaw = row[g.innerBoxCol];   // small
        const imeiRaw = row[g.imeiCol];

        const master = normalizeBox(masterRaw);
        const inner = normalizeBox(innerRaw);
        const imei = normalizeImei(imeiRaw);

        if (master) st.master = master;
        if (inner) st.inner = inner;

        if (!imei || !isLikelyImei(imei)) continue;

        const device = g.device || normalizeDevice(st.master) || "UNKNOWN";
        const bigBox = st.master;           // ✅ BIG CARTON is the primary box_no
        const smallBox = st.inner || "";    // optional

        if (!device || device === "UNKNOWN" || !bigBox) continue;

        itemsParsed.push({ device, box_no: bigBox, inner_box_no: smallBox, imei });
      }
    }

    if (itemsParsed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid IMEI rows found across detected device blocks." },
        { status: 400 }
      );
    }

    // Duplicate check inside file
    const seen = new Map<string, number>();
    for (const it of itemsParsed) seen.set(it.imei, (seen.get(it.imei) ?? 0) + 1);

    const duplicatesInFile = Array.from(seen.entries())
      .filter(([, n]) => n > 1)
      .map(([imei, count]) => ({ imei, count }));

    if (duplicatesInFile.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Duplicate IMEI detected in the uploaded file. Import aborted.",
          duplicates_in_file: duplicatesInFile.slice(0, 50),
          duplicates_in_file_total: duplicatesInFile.length,
        },
        { status: 400 }
      );
    }

    // Existing IMEI check in DB
    const uniqueImeis = Array.from(seen.keys());
    const existingImeis = new Set<string>();
    const chunkSize = 500;

    for (let i = 0; i < uniqueImeis.length; i += chunkSize) {
      const chunk = uniqueImeis.slice(i, i + chunkSize);
      const { data: exItems, error: exItemErr } = await supabase.from("items").select("imei").in("imei", chunk);
      if (exItemErr) return NextResponse.json({ ok: false, error: exItemErr.message }, { status: 500 });
      for (const it of exItems ?? []) existingImeis.add(String(it.imei));
    }

    if (existingImeis.size > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "One or more IMEIs already exist in the database. Import aborted.",
          existing_imeis: Array.from(existingImeis).slice(0, 50),
          existing_imeis_total: existingImeis.size,
        },
        { status: 409 }
      );
    }

    // ✅ Group by BIG CARTON only: (device + box_no)
    const byBox = new Map<string, { device: string; box_no: string; imeis: string[]; small_boxes: Set<string> }>();
    for (const it of itemsParsed) {
      const key = `${it.device}__${it.box_no}`;
      const g = byBox.get(key) ?? { device: it.device, box_no: it.box_no, imeis: [], small_boxes: new Set<string>() };
      g.imeis.push(it.imei);
      if (it.inner_box_no) g.small_boxes.add(it.inner_box_no);
      byBox.set(key, g);
    }

    const boxesArr = Array.from(byBox.values());

    const devicesSet = new Set<string>(boxesArr.map((b) => b.device));
    const devicesCount = devicesSet.size;
    const boxesCount = boxesArr.length;
    const itemsCount = itemsParsed.length;

    // Ensure devices exist
    try {
      const upsertDevices = Array.from(devicesSet).map((d) => ({ device: d }));
      if (upsertDevices.length > 0) await supabase.from("devices").upsert(upsertDevices, { onConflict: "device" });
    } catch {}

    // Identify user
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;
    const userEmail = userRes?.user?.email ?? null;

    // History
    const { data: importRow, error: importErr } = await supabase
      .from("inbound_imports")
      .insert({
        file_name: file.name,
        devices_count: devicesCount,
        boxes_count: boxesCount,
        items_count: itemsCount,
        location,
        created_by_email: userEmail,
        ...(userId ? { created_by: userId } : {}),
        devices: Array.from(devicesSet),
      })
      .select("import_id")
      .single();

    if (importErr) return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });

    const import_id = importRow.import_id as string;

    // boxes table uses (device, box_no) where box_no = BIG CARTON
    const allBoxNos = Array.from(new Set(boxesArr.map((b) => b.box_no)));

    const { data: existingBoxes, error: exErr } = await supabase
      .from("boxes")
      .select("box_id, box_no, device")
      .in("box_no", allBoxNos);

    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });

    const existingMap = new Map<string, any>();
    for (const b of existingBoxes ?? []) existingMap.set(`${b.device}__${b.box_no}`, b);

    const toInsertBoxes = boxesArr
      .filter((b) => !existingMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({
        device: b.device,
        box_no: b.box_no, // ✅ BIG CARTON
        master_box_no: null, // not used (we keep big carton in box_no)
        status: "IN",
        location,
      }));

    if (toInsertBoxes.length > 0) {
      const { data: ins, error: insErr } = await supabase.from("boxes").insert(toInsertBoxes).select("box_id, box_no, device");
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      for (const b of ins ?? []) existingMap.set(`${b.device}__${b.box_no}`, b);
    }

    // Update location for those box_nos
    await supabase.from("boxes").update({ location }).in("box_no", allBoxNos);

    // Insert items linked to BIG CARTON box_id
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

    // inbound_import_boxes detail
    // NOTE: we store a compact string of small boxes in master_box_no field (since you asked BIG carton as box_no)
    const importBoxesRows = boxesArr.map((b) => {
      const box = existingMap.get(`${b.device}__${b.box_no}`);
      if (!box?.box_id) throw new Error(`Missing box_id for import device=${b.device} box_no=${b.box_no}`);

      const smallBoxes = Array.from(b.small_boxes);
      const smallInfo = smallBoxes.length === 0 ? null : smallBoxes.length === 1 ? smallBoxes[0] : `MULTI(${smallBoxes.length})`;

      return {
        import_id,
        box_id: box.box_id,
        device: b.device,
        master_box_no: smallInfo, // repurposed: info about small boxes
        box_no: b.box_no,         // ✅ BIG CARTON
        qty: b.imeis.length,
      };
    });

    const { error: impBoxErr } = await supabase.from("inbound_import_boxes").insert(importBoxesRows);
    if (impBoxErr) return NextResponse.json({ ok: false, error: impBoxErr.message }, { status: 500 });

    // Labels payload (1 label per BIG CARTON)
    const labels = boxesArr.map((b) => {
      const device = String(b.device || "").trim();
      const box_no = String(b.box_no || "").trim();

      const qr_data = buildQrDataFromImeis(b.imeis);

      return {
        box_id: existingMap.get(`${device}__${box_no}`)?.box_id ?? "",
        device,
        box_no, // ✅ BIG CARTON on label
        qty: b.imeis.length,
        qr_data,
        imeis: b.imeis,
      };
    });

    const zpl_all = labels
      .map((l) => buildZpl({ qrData: String(l.qr_data || ""), device: String(l.device), boxNo: String(l.box_no) }))
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      import_id,
      file_name: file.name,
      location,
      detected_groups: groups.map((g) => ({ device: g.device, startCol: g.startCol, imeiCol: g.imeiCol })),
      boxes: boxesCount,
      devices: devicesCount,
      parsed_items: itemsParsed.length,
      inserted_items: insertedItems,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}