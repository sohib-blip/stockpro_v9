import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/* ===============================
   SUPABASE CLIENTS
================================ */

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { detectSessionInUrl: false },
    }
  );
}

/* ===============================
   HELPERS
================================ */

const normalize = (v: any) =>
  String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const isImei = (v: any) => {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
};

function extractBoxNo(cell: any) {
  const s = String(cell ?? "");
  const m = s.match(/(\d{3}-\d{3})/);
  return m ? m[1] : null;
}

function extractRawDevice(cell: any) {
  const s = String(cell ?? "").trim();
  if (!s) return null;
  return s.split("-")[0];
}

/* ===============================
   DEVICE RESOLVER (IMPORTANT)
================================ */

function resolveDevice(raw: string, devices: any[]) {
  const canon = normalize(raw);

  // FMC9202MAUWU -> FMC920
  const m = canon.match(/^([A-Z]+)(\d{3})/);
  if (m) {
    const short = m[1] + m[2];
    const found = devices.find((d) => d.canonical_name === short);
    if (found) return found.device;
  }

  // FMC03 -> FMC003
  const m2 = canon.match(/^([A-Z]+)(\d{1,2})$/);
  if (m2) {
    const padded = m2[1] + m2[2].padStart(3, "0");
    const found = devices.find((d) => d.canonical_name === padded);
    if (found) return found.device;
  }

  // exact match
  const exact = devices.find((d) => canon === d.canonical_name);
  return exact ? exact.device : null;
}

/* ===============================
   HEADER + BLOCK DETECTION
================================ */

function detectHeaderRow(rows: any[][]) {
  for (let i = 0; i < 40; i++) {
    const r = rows[i] || [];
    if (
      r.some((c) => String(c).toLowerCase().includes("box")) &&
      r.some((c) => String(c).toLowerCase().includes("imei"))
    ) {
      return i;
    }
  }
  return -1;
}

function detectBlocks(header: string[]) {
  const blocks = [];
  for (let i = 0; i < header.length; i++) {
    if (header[i].includes("box")) {
      const imeiCol = header.findIndex(
        (h, idx) => idx >= i && h.includes("imei")
      );
      if (imeiCol > -1) {
        blocks.push({ boxCol: i, imeiCol });
        i = imeiCol;
      }
    }
  }
  return blocks;
}

/* ===============================
   MAIN PREVIEW
================================ */

export async function POST(req: Request) {
  try {
    const admin = adminClient();

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) throw new Error("Unauthorized");

    const userClient = authedClient(token);
    const { error } = await userClient.auth.getUser();
    if (error) throw new Error("Unauthorized");

    const form = await req.formData();
    const file = form.get("file") as File;
    if (!file) throw new Error("Missing file");

    /* ===============================
       LOAD DEVICES DB
    ================================ */

    const { data: devicesDb } = await admin
      .from("devices")
      .select("canonical_name, device")
      .eq("active", true);

    /* ===============================
       READ EXCEL
    ================================ */

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) throw new Error("Header not found");

    const header = rows[headerIdx].map((x) =>
      String(x).toLowerCase().trim()
    );
    const blocks = detectBlocks(header);

    const labelsMap = new Map<string, any>();
    const unknownDevices = new Set<string>();

    for (const block of blocks) {
      let currentDevice: string | null = null;
      let currentBox: string | null = null;

      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];

        if (row[block.boxCol]) {
          const rawDev = extractRawDevice(row[block.boxCol]);
          const resolved = rawDev
            ? resolveDevice(rawDev, devicesDb || [])
            : null;

          if (rawDev && !resolved) unknownDevices.add(rawDev);
          currentDevice = resolved;
          currentBox = extractBoxNo(row[block.boxCol]);
        }

        const imei = isImei(row[block.imeiCol]);
        if (!imei || !currentDevice || !currentBox) continue;

        const key = `${currentDevice}__${currentBox}`;
        if (!labelsMap.has(key)) {
          labelsMap.set(key, {
            device: currentDevice,
            box_no: currentBox,
            imeis: [],
          });
        }
        labelsMap.get(key).imeis.push(imei);
      }
    }

    if (unknownDevices.size) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "device(s) not found in Admin > Devices",
          unknown_devices: Array.from(unknownDevices),
        },
        { status: 400 }
      );
    }

    const labels = Array.from(labelsMap.values()).map((l) => {
      const uniq = Array.from(new Set(l.imeis));
      return {
        device: l.device,
        box_no: l.box_no,
        qty: uniq.length,
        qr_data: uniq.join("\n"), // ✅ IMEI only
      };
    });

    return NextResponse.json({
      ok: true,
      devices: new Set(labels.map((l) => l.device)).size,
      boxes: labels.length,
      items: labels.reduce((a, b) => a + b.qty, 0),
      labels,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}