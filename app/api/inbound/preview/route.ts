import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/* ===============================
   SUPABASE
================================ */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, detectSessionInUrl: false } }
  );
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
   SAFE HELPERS (NO CRASH)
================================ */

const safeStr = (v: any) => String(v ?? "");
const norm = (v: any) =>
  safeStr(v).toUpperCase().replace(/[^A-Z0-9]/g, "");

const isImei = (v: any) => {
  const s = safeStr(v).replace(/\D/g, "");
  return s.length === 15 ? s : null;
};

function extractBoxNo(v: any) {
  const m = safeStr(v).match(/(\d{3}-\d{3})/);
  return m ? m[1] : null;
}

function extractRawDevice(v: any) {
  const s = safeStr(v).trim();
  if (!s) return null;
  return s.split("-")[0];
}

/* ===============================
   DEVICE RESOLVER (FIX FMC 920)
================================ */

function resolveDevice(raw: string, devices: any[]) {
  const canon = norm(raw);

  // FMC 9202 MAUWU -> FMC920
  const m = canon.match(/^([A-Z]+)(\d{3})/);
  if (m) {
    const short = m[1] + m[2];
    const found = devices.find((d) => d.canonical_name === short);
    if (found) return found.device;
  }

  // FMC 03 -> FMC003
  const m2 = canon.match(/^([A-Z]+)(\d{1,2})$/);
  if (m2) {
    const padded = m2[1] + m2[2].padStart(3, "0");
    const found = devices.find((d) => d.canonical_name === padded);
    if (found) return found.device;
  }

  // Exact match
  const exact = devices.find((d) => d.canonical_name === canon);
  return exact ? exact.device : null;
}

/* ===============================
   HEADER + BLOCKS (SAFE)
================================ */

function detectHeaderRow(rows: any[][]) {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] || [];
    const hasBox = r.some((c) => safeStr(c).toLowerCase().includes("box"));
    const hasImei = r.some((c) => safeStr(c).toLowerCase().includes("imei"));
    if (hasBox && hasImei) return i;
  }
  return -1;
}

function detectBlocks(header: string[]) {
  const blocks: { boxCol: number; imeiCol: number }[] = [];

  for (let i = 0; i < header.length; i++) {
    const h = safeStr(header[i]);
    if (!h.includes("box")) continue;

    let imeiCol = -1;
    for (let j = i; j < header.length; j++) {
      if (safeStr(header[j]).includes("imei")) {
        imeiCol = j;
        break;
      }
    }

    if (imeiCol >= 0) {
      blocks.push({ boxCol: i, imeiCol });
      i = imeiCol;
    }
  }
  return blocks;
}

/* ===============================
   PREVIEW ENDPOINT
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

    const { data: devicesDb } = await admin
      .from("devices")
      .select("canonical_name, device")
      .eq("active", true);

    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

    const headerIdx = detectHeaderRow(rows);
    if (headerIdx < 0) throw new Error("Header not found");

    const header = (rows[headerIdx] || []).map((x) =>
      safeStr(x).toLowerCase()
    );
    const blocks = detectBlocks(header);

    const labelsMap = new Map<string, any>();
    const unknown = new Set<string>();

    for (const block of blocks) {
      let currentDevice: string | null = null;
      let currentBox: string | null = null;

      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];

        if (row[block.boxCol]) {
          const raw = extractRawDevice(row[block.boxCol]);
          const resolved = raw ? resolveDevice(raw, devicesDb || []) : null;
          if (raw && !resolved) unknown.add(raw);
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

    if (unknown.size) {
      return NextResponse.json(
        {
          ok: false,
          error: "device(s) not found in Admin > Devices",
          unknown_devices: Array.from(unknown),
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
        qr_data: uniq.join("\n"),
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