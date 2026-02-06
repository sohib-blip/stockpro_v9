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

const norm = (v: any) => String(v ?? "").toLowerCase().trim();

const normalizeImei = (v: any) => String(v ?? "").replace(/\D/g, "");
const isImei = (s: string) => /^\d{14,17}$/.test(s);

const normalizeBox = (v: any) => String(v ?? "").trim();
const normalizeDevice = (v: any) =>
  String(v ?? "")
    .replace(/[^a-zA-Z0-9\- ]/g, "")
    .trim()
    .toUpperCase();

function buildQrDataFromImeis(imeis: string[]) {
  return Array.from(new Set(imeis)).join("\n"); // ✅ 1 IMEI par ligne
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

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const supabase = authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") || "00");

    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const buffer = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (rows.length < 2) {
      return NextResponse.json({ ok: false, error: "Empty Excel" }, { status: 400 });
    }

    const headerRowIndex = rows.findIndex((r) =>
      r.some((c) => norm(c).includes("imei"))
    );
    if (headerRowIndex < 0) {
      return NextResponse.json({ ok: false, error: "IMEI column not found" }, { status: 400 });
    }

    const header = rows[headerRowIndex].map(norm);

    const imeiCol = header.findIndex((h) => h === "imei" || h.includes("imei"));
    const boxCol = header.findIndex((h) => h.includes("box"));

    // ✅ device facultatif
    const deviceCol = header.findIndex(
      (h) =>
        h === "device" ||
        h.includes("model") ||
        h.includes("product") ||
        h.includes("type")
    );

    if (imeiCol < 0 || boxCol < 0) {
      return NextResponse.json({ ok: false, error: "Missing required columns" }, { status: 400 });
    }

    // 👉 fallback device = nom du fichier
    const fallbackDevice = normalizeDevice(file.name.split(".")[0]);

    const parsed: { device: string; box: string; imei: string }[] = [];

    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r];
      const imei = normalizeImei(row[imeiCol]);
      if (!isImei(imei)) continue;

      const box = normalizeBox(row[boxCol]);
      if (!box) continue;

      const device =
        deviceCol >= 0 ? normalizeDevice(row[deviceCol]) : fallbackDevice;

      if (!device) continue;

      parsed.push({ device, box, imei });
    }

    if (!parsed.length) {
      return NextResponse.json({ ok: false, error: "No IMEIs found" }, { status: 400 });
    }

    const grouped = new Map<string, { device: string; box: string; imeis: string[] }>();
    for (const p of parsed) {
      const key = `${p.device}__${p.box}`;
      if (!grouped.has(key)) grouped.set(key, { device: p.device, box: p.box, imeis: [] });
      grouped.get(key)!.imeis.push(p.imei);
    }

    const boxes = Array.from(grouped.values());

    await supabase.from("devices").upsert(
      boxes.map((b) => ({ device: b.device })),
      { onConflict: "device" }
    );

    const { data: imp, error: impErr } = await supabase
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

    if (impErr) {
      return NextResponse.json({ ok: false, error: impErr.message }, { status: 500 });
    }

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
      import_id: imp.import_id,
      boxes: boxes.length,
      devices: new Set(boxes.map((b) => b.device)).size,
      items: parsed.length,
      labels,
      zpl_all,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}