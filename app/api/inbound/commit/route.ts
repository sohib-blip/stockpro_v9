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
  return String(v ?? "").replace(/\D/g, "");
}

function isLikelyImei(s: string) {
  return /^\d{14,17}$/.test(s);
}

function buildQrDataFromImeis(imeis: string[]) {
  const unique = Array.from(
    new Set(
      imeis
        .map((x) => normalizeImei(x))
        .filter((x) => isLikelyImei(x))
    )
  );
  return unique.join("\n"); // ✅ QR = IMEI only, one per line
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

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") || "00");

    if (!file) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = to2dArray(ws);

    if (rows.length < 2) {
      return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });
    }

    const headerRow = rows.findIndex((r) =>
      r.some((c: any) => safeIncludes(normHeader(c), "imei"))
    );

    if (headerRow < 0) {
      return NextResponse.json({ ok: false, error: "IMEI column not found" }, { status: 400 });
    }

    const header = rows[headerRow].map(normHeader);

    const imeiCol = header.findIndex((h) => h === "imei" || safeIncludes(h, "imei"));
    const boxCol = header.findIndex((h) => safeIncludes(h, "box"));
    const deviceCol = header.findIndex((h) => safeIncludes(h, "device"));

    if (imeiCol < 0 || boxCol < 0 || deviceCol < 0) {
      return NextResponse.json({ ok: false, error: "Missing required columns" }, { status: 400 });
    }

    const parsed: { device: string; box: string; imei: string }[] = [];

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const imei = normalizeImei(row[imeiCol]);
      if (!isLikelyImei(imei)) continue;

      const device = normalizeDevice(row[deviceCol]);
      const box = normalizeBox(row[boxCol]);
      if (!device || !box) continue;

      parsed.push({ device, box, imei });
    }

    if (!parsed.length) {
      return NextResponse.json({ ok: false, error: "No IMEIs detected" }, { status: 400 });
    }

    // Group by device + box
    const grouped = new Map<string, { device: string; box: string; imeis: string[] }>();
    for (const p of parsed) {
      const key = `${p.device}__${p.box}`;
      if (!grouped.has(key)) grouped.set(key, { device: p.device, box: p.box, imeis: [] });
      grouped.get(key)!.imeis.push(p.imei);
    }

    const boxes = Array.from(grouped.values());

    // Ensure devices exist
    await supabase.from("devices").upsert(
      boxes.map((b) => ({ device: b.device })),
      { onConflict: "device" }
    );

    // Insert import history (NO devices column)
    const { data: importRow, error: importErr } = await supabase
      .from("inbound_imports")
      .insert({
        file_name: file.name,
        location,
        devices_count: new Set(boxes.map((b) => b.device)).size,
        boxes_count: boxes.length,
        items_count: parsed.length,
      })
      .select("import_id")
      .single();

    if (importErr) {
      return NextResponse.json({ ok: false, error: importErr.message }, { status: 500 });
    }

    const import_id = importRow.import_id;

    // Labels + ZPL
    const labels = boxes.map((b) => ({
      device: b.device,
      box_no: b.box,
      qty: b.imeis.length,
      qr_data: buildQrDataFromImeis(b.imeis),
    }));

    const zpl_all = labels
      .map((l) => buildZpl({ qrData: l.qr_data, device: l.device, boxNo: l.box_no }))
      .join("\n\n");

    return NextResponse.json({
      ok: true,
      import_id,
      boxes: boxes.length,
      devices: new Set(boxes.map((b) => b.device)).size,
      parsed_items: parsed.length,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}