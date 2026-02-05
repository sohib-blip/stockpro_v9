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

async function ensureProfileEmail(supabase: any, user: any) {
  try {
    const user_id = String(user?.id || "");
    const email = String(user?.email || "").trim();
    if (!user_id || !email) return;
    // Best-effort: keep profiles.email in sync so history can show the creator.
    await supabase.from("profiles").upsert({ user_id, email }, { onConflict: "user_id" });
  } catch {
    // ignore
  }
}

function normalizeDevice(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // Exemple: FMC234WC3XWU-025-007 -> FMC234WC3XWU
  return s.split("-")[0].trim().toUpperCase();
}

function normalizeBox(boxRaw: string) {
  return String(boxRaw || "").trim();
}

function normalizeImei(v: any) {
  const s = String(v ?? "").trim();
  const digits = s.replace(/\D/g, "");
  return digits;
}

function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}

function looksLikeInnerBoxNo(v: any) {
  const s = String(v ?? "").trim();
  // Typical inner/small box format: 025-36 / 025-305
  return /^\d{2,4}-\d{1,4}$/.test(s);
}

function looksLikeMasterBoxNo(v: any) {
  const s = String(v ?? "").trim();
  // Typical master/big carton format: DEVICE-025-060 (contains letters)
  return /[A-Z]/i.test(s) && /-\d{2,4}-\d{1,4}$/.test(s);
}

function detectColumns(rows: any[][]) {
  // Try to find header row and columns by name (supplier files may vary).
  const maxScan = Math.min(rows.length, 25);
  let headerRowIdx = -1;
  let deviceCol = 0;
  let masterBoxCol: number | null = null;
  let innerBoxCol: number | null = null;
  let imeiCol = 3;

  const norm = (v: any) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r] || [];
    const cells = row.map(norm);

    const hasImei = cells.some((c) => c.includes("imei"));
    const hasBox = cells.some((c) => c.includes("box"));
    const hasDevice = cells.some((c) => c.includes("device") || c.includes("model") || c.includes("type"));

    if (hasImei && (hasBox || hasDevice)) {
      headerRowIdx = r;

      const imeiIdx = cells.findIndex((c) => c.includes("imei"));
      if (imeiIdx >= 0) imeiCol = imeiIdx;

      let devIdx = cells.findIndex((c) => c.includes("device"));
      if (devIdx < 0) devIdx = cells.findIndex((c) => c.includes("model") || c.includes("type"));
      if (devIdx >= 0) deviceCol = devIdx;

      const boxCandidates: number[] = [];
      cells.forEach((c, idx) => {
        if (c.includes("boxnr") || c.includes("box nr") || c.includes("box no") || c === "box" || c.includes("box")) {
          boxCandidates.push(idx);
        }
      });

      const scanRows = rows.slice(r + 1, Math.min(rows.length, r + 31));
      const score = (idx: number) => {
        let masterScore = 0;
        let innerScore = 0;
        for (const rr of scanRows) {
          const v = rr?.[idx];
          if (looksLikeMasterBoxNo(v)) masterScore++;
          if (looksLikeInnerBoxNo(v)) innerScore++;
        }
        return { masterScore, innerScore };
      };

      let bestMaster: number | null = null;
      let bestInner: number | null = null;
      let bestMasterScore = -1;
      let bestInnerScore = -1;

      for (const idx of boxCandidates) {
        const s = score(idx);
        if (s.masterScore > bestMasterScore) {
          bestMasterScore = s.masterScore;
          bestMaster = idx;
        }
        if (s.innerScore > bestInnerScore) {
          bestInnerScore = s.innerScore;
          bestInner = idx;
        }
      }

      if (bestInner != null && bestInnerScore > 0) innerBoxCol = bestInner;
      if (bestMaster != null && bestMasterScore > 0) masterBoxCol = bestMaster;

      if (innerBoxCol == null && boxCandidates.length > 0) innerBoxCol = boxCandidates[boxCandidates.length - 1];
      if (masterBoxCol == null && boxCandidates.length > 0) masterBoxCol = boxCandidates[0];

      if (masterBoxCol === innerBoxCol) masterBoxCol = null;

      break;
    }
  }

  return { headerRowIdx, deviceCol, masterBoxCol, innerBoxCol, imeiCol };
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
  // Zebra ZD220 (203dpi) – label shows: QR + Device + Box number
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
    const columnsRaw = form.get("columns") as string | null;

    // ✅ NEW: location from inbound page dropdown
    const locationRaw = String(form.get("location") || "00").trim();
    const location = locationRaw === "00" || locationRaw === "1" || locationRaw === "6" || locationRaw === "Cabinet" ? locationRaw : "00";

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const cols = columnsRaw ? JSON.parse(columnsRaw) : null;
    let deviceCol = Number((cols as any)?.deviceCol ?? 0);
    let masterBoxCol: number | null = (cols as any)?.masterBoxCol != null ? Number((cols as any)?.masterBoxCol) : null;
    let innerBoxCol: number | null = (cols as any)?.innerBoxCol != null ? Number((cols as any)?.innerBoxCol) : null;
    if (innerBoxCol == null && (cols as any)?.boxCol != null) innerBoxCol = Number((cols as any)?.boxCol);
    let imeiCol = Number((cols as any)?.imeiCol ?? 3);

    if (masterBoxCol != null) innerBoxCol = null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows || rows.length < 2) {
      return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });
    }

    if (!cols) {
      const detected = detectColumns(rows);
      deviceCol = detected.deviceCol;
      masterBoxCol = detected.masterBoxCol;
      innerBoxCol = detected.innerBoxCol;
      imeiCol = detected.imeiCol;
      if (masterBoxCol != null) innerBoxCol = null;
    }

    if (innerBoxCol == null) innerBoxCol = 1;

    const topLeft = rows?.[0]?.[0];
    const defaultDeviceTop = normalizeDevice(String(topLeft ?? ""));

    let startIdx = 0;
    for (let i = 0; i < rows.length; i++) {
      const imei = normalizeImei(rows[i]?.[imeiCol]);
      if (isLikelyImei(imei)) {
        startIdx = i;
        break;
      }
    }

    const itemsParsed: Array<{ device: string; master_box_no: string; box_no: string; imei: string }> = [];

    let currentDevice = "";
    let currentMasterBoxNo = "";
    let currentInnerBoxNo = "";

    for (let i = startIdx; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;

      const deviceRaw = r[deviceCol];
      const masterRaw = masterBoxCol != null ? r[masterBoxCol] : null;
      const innerRaw = innerBoxCol != null ? r[innerBoxCol] : null;
      const imeiRaw = r[imeiCol];

      const maybeDevice = normalizeDevice(deviceRaw);
      const maybeMaster = normalizeBox(masterRaw as any);
      const maybeInner = normalizeBox(innerRaw as any);

      if (maybeDevice) currentDevice = maybeDevice;
      if (!currentDevice && defaultDeviceTop) currentDevice = defaultDeviceTop;
      if (maybeMaster) currentMasterBoxNo = maybeMaster;
      if (maybeInner) currentInnerBoxNo = maybeInner;

      const device = currentDevice;

      const box_no = currentMasterBoxNo || currentInnerBoxNo;
      const master_box_no = currentMasterBoxNo || box_no;

      const imei = normalizeImei(imeiRaw);

      if (!device || !box_no || !imei) continue;
      if (!isLikelyImei(imei)) continue;

      itemsParsed.push({ device, master_box_no, box_no, imei });
    }

    if (itemsParsed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid rows found. Check the supplier file format." },
        { status: 400 }
      );
    }

    // Duplicate protection (hard fail)
    const seen = new Map<string, number>();
    for (const it of itemsParsed) {
      seen.set(it.imei, (seen.get(it.imei) ?? 0) + 1);
    }
    const duplicatesInFile = Array.from(seen.entries())
      .filter(([, n]) => n > 1)
      .map(([imei, n]) => ({ imei, count: n }));

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

    // Group by box
    const byBox = new Map<string, { device: string; master_box_no: string; box_no: string; imeis: string[] }>();
    for (const it of itemsParsed) {
      const key = `${it.device}__${it.master_box_no}__${it.box_no}`;
      const g = byBox.get(key) ?? { device: it.device, master_box_no: it.master_box_no, box_no: it.box_no, imeis: [] };
      g.imeis.push(it.imei);
      byBox.set(key, g);
    }

    const boxesArr = Array.from(byBox.values());
    const devicesSet = new Set<string>(boxesArr.map((b) => b.device));
    const devicesCount = devicesSet.size;
    const boxesCount = boxesArr.length;
    const itemsCount = itemsParsed.length;

    // Identify user (for audit trail)
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;
    if (userRes?.user) await ensureProfileEmail(supabase, userRes.user);

    // 1) create inbound_imports history (now includes location)
    const { data: importRow, error: importErr } = await supabase
      .from("inbound_imports")
      .insert({
        file_name: file.name,
        devices_count: devicesCount,
        boxes_count: boxesCount,
        items_count: itemsCount,
        location, // ✅ NEW
        ...(userId ? { created_by: userId } : {}),
      })
      .select("import_id")
      .single();

    if (importErr) {
      return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });
    }

    const import_id = importRow.import_id as string;

    // 2) create/upsert boxes (store location on inserted boxes)
    const allBoxNos = boxesArr.map((b) => b.box_no);

    const { data: existingBoxes, error: exErr } = await supabase.from("boxes").select("box_id, box_no, device").in("box_no", allBoxNos);
    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });

    const existingMap = new Map<string, any>();
    for (const b of existingBoxes ?? []) {
      existingMap.set(`${b.device}__${b.box_no}`, b);
    }

    const toInsertBoxes = boxesArr
      .filter((b) => !existingMap.has(`${b.device}__${b.box_no}`))
      .map((b) => ({
        device: b.device,
        box_no: b.box_no,
        master_box_no: b.master_box_no,
        status: "IN",
        location, // ✅ NEW
      }));

    let insertedBoxes: any[] = [];
    if (toInsertBoxes.length > 0) {
      const { data: ins, error: insErr } = await supabase.from("boxes").insert(toInsertBoxes).select("box_id, box_no, device");
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      insertedBoxes = ins ?? [];
      for (const b of insertedBoxes) existingMap.set(`${b.device}__${b.box_no}`, b);
    }

    // (Optional) also set location on existing boxes from this import
    // If you prefer NOT to override existing location, comment this out.
    if (allBoxNos.length > 0) {
      await supabase.from("boxes").update({ location }).in("box_no", allBoxNos);
    }

    // 3) insert items
    const itemsToInsert = itemsParsed.map((x) => {
      const box = existingMap.get(`${x.device}__${x.box_no}`);
      if (!box?.box_id) {
        throw new Error(`Missing box_id for device=${x.device} box_no=${x.box_no}. Box must exist before inserting items.`);
      }
      return {
        imei: x.imei,
        box_id: box.box_id,
        status: "IN",
      };
    });

    let insertedItems = 0;
    for (let i = 0; i < itemsToInsert.length; i += 1000) {
      const chunk = itemsToInsert.slice(i, i + 1000);
      const { error: insItemErr } = await supabase.from("items").insert(chunk);
      if (insItemErr) return NextResponse.json({ ok: false, error: insItemErr.message }, { status: 500 });
      insertedItems += chunk.length;
    }

    // 4) inbound_import_boxes detail per box
    const importBoxesRows = boxesArr.map((b) => {
      const box = existingMap.get(`${b.device}__${b.box_no}`);
      if (!box?.box_id) {
        throw new Error(`Missing box_id for import box device=${b.device} box_no=${b.box_no}.`);
      }
      return {
        import_id,
        box_id: box.box_id,
        device: b.device,
        master_box_no: b.master_box_no,
        box_no: b.box_no,
        qty: b.imeis.length,
      };
    });

    const { error: impBoxErr } = await supabase.from("inbound_import_boxes").insert(importBoxesRows);
    if (impBoxErr) return NextResponse.json({ ok: false, error: impBoxErr.message }, { status: 500 });

    // 5) Build labels payload + ZPL
    // ✅ QR = IMEIs only (one per line)
    const labels = boxesArr.map((b) => {
      const device = String(b.device || "").trim();
      const box_no = String(b.box_no || "").trim();
      const master_box_no = String(b.master_box_no || "").trim();
      const qty = Array.isArray(b.imeis) ? b.imeis.length : 0;

      const qr_data = buildQrDataFromImeis(b.imeis ?? []);

      return {
        box_id: existingMap.get(`${device}__${box_no}`)?.box_id ?? "",
        device,
        master_box_no,
        box_no,
        qty,
        qr_data,
        imeis: b.imeis ?? [],
      };
    });

    const zplParts: string[] = [];
    for (const l of labels) {
      const qrData = String(l.qr_data || "");
      zplParts.push(buildZpl({ qrData, device: String(l.device), boxNo: String(l.box_no) }));
    }
    const zpl_all = zplParts.join("\n\n");

    return NextResponse.json({
      ok: true,
      import_id,
      file_name: file.name,
      location, // ✅ returned for UI
      rows: rows.length,
      boxes: boxesCount,
      devices: devicesCount,
      parsed_items: itemsParsed.length,
      inserted_items: insertedItems,
      skipped_existing_imei: 0,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}