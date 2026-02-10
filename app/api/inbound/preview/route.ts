import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

function canonicalize(s: string) {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isImei(v: any) {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

function extractBoxAndRawDevice(cell: any) {
  const s = String(cell ?? "").trim();
  if (!s) return { rawDevice: null, boxNo: null };

  const boxMatch = s.match(/(\d{3}-\d{3})/);
  const rawDevice = s.split("-")[0]?.trim() || null;

  return {
    rawDevice,
    boxNo: boxMatch ? boxMatch[1] : null,
  };
}

export async function POST(req: Request) {
  try {
    const admin = adminClient();

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const location = String(form.get("location") || "00");

    if (!file) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "Empty Excel" }, { status: 400 });
    }

    // Load devices from DB
    const { data: devices } = await admin
      .from("devices")
      .select("canonical_name, device")
      .eq("active", true);

    const deviceMap = new Map(
      (devices || []).map((d: any) => [d.canonical_name, d.device])
    );

    const parsed = new Map<string, { device: string; box_no: string; imeis: string[] }>();
    const unknownDevices = new Set<string>();

    for (const row of rows) {
      for (let c = 0; c < row.length; c++) {
        const { rawDevice, boxNo } = extractBoxAndRawDevice(row[c]);
        if (!rawDevice || !boxNo) continue;

        const canonical = canonicalize(rawDevice);
        const deviceName = deviceMap.get(canonical);

        if (!deviceName) {
          unknownDevices.add(rawDevice);
          continue;
        }

        for (let i = c + 1; i < row.length; i++) {
          const imei = isImei(row[i]);
          if (!imei) continue;

          const key = `${deviceName}__${boxNo}`;
          if (!parsed.has(key)) {
            parsed.set(key, { device: deviceName, box_no: boxNo, imeis: [] });
          }
          parsed.get(key)!.imeis.push(imei);
        }
      }
    }

    if (unknownDevices.size) {
      return NextResponse.json(
        {
          ok: false,
          error: `Device(s) not found in Admin > Devices: ${Array.from(unknownDevices).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const labels = Array.from(parsed.values()).map((l) => {
      const uniq = Array.from(new Set(l.imeis));
      return {
        device: l.device,
        box_no: l.box_no,
        qty: uniq.length,
        qr_data: uniq.join("\n"),
      };
    });

    return NextResponse.json({
      ok: true,
      location,
      devices: new Set(labels.map((l) => l.device)).size,
      boxes: labels.length,
      items: labels.reduce((a, b) => a + b.qty, 0),
      labels,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}