export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function looksLikeImei(v: any) {
  const s = String(v ?? "").replace(/\s+/g, "");
  // IMEI = souvent 15 digits
  return /^\d{14,16}$/.test(s);
}

function extractDeviceAndBoxNr(raw: any): { deviceDisplay: string; canonical: string; boxNo: string } | null {
  const s0 = String(raw ?? "").trim();
  if (!s0) return null;

  // Exemple: "FMB 140BTZ9FD-076-004"
  // On enlève espaces pour la détection des morceaux
  const s = s0.replace(/\s+/g, "");

  const parts = s.split("-").filter(Boolean);
  if (parts.length < 3) return null;

  // boxnr = les 2 derniers morceaux (076-004)
  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];
  if (!/^\d+$/.test(last) || !/^\d+$/.test(prev)) return null;

  const boxNo = `${prev}-${last}`;

  // device prefix = tout avant le premier "-" (ex: FMB140BTZ9FD)
  const prefix = parts[0] || "";
  if (!prefix) return null;

  // On garde seulement le début lettre+chiffre (ex: FMB140)
  const m = prefix.match(/^([A-Za-z]+)(\d+)/);
  if (!m) {
    // fallback: juste lettres+digits mélangés -> canonical
    const can = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!can) return null;
    return { deviceDisplay: can, canonical: can, boxNo };
  }

  const letters = m[1].toUpperCase();
  const digits = m[2];
  const canonical = `${letters}${digits}`; // FMB140
  const deviceDisplay = `${letters} ${digits}`; // FMB 140

  return { deviceDisplay, canonical, boxNo };
}

type Pair = { boxCol: number; imeiCol: number };

function detectHeaderRow(rows: any[][]) {
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const row = rows[r] || [];
    const cells = row.map((x) => norm(x));
    const hasBox = cells.some((c) => c.includes("box"));
    const hasImei = cells.some((c) => c.includes("imei") || c.includes("serial"));
    if (hasBox && hasImei) return r;
  }
  return -1;
}

function detectPairs(header: string[]): Pair[] {
  const pairs: Pair[] = [];

  // stratégie 1: box col + imei col juste à droite
  for (let i = 0; i < header.length; i++) {
    const h = header[i] || "";
    const isBox = h.includes("box");
    if (!isBox) continue;

    // cherche IMEI dans les 3 colonnes suivantes (souvent juste à côté)
    for (let j = i + 1; j <= Math.min(header.length - 1, i + 3); j++) {
      const hj = header[j] || "";
      const isImei = hj.includes("imei") || hj.includes("serial");
      if (isImei) {
        pairs.push({ boxCol: i, imeiCol: j });
        break;
      }
    }
  }

  // stratégie 2 fallback: si rien trouvé, prend tous box + tous imei et les associe par proximité
  if (pairs.length === 0) {
    const boxCols: number[] = [];
    const imeiCols: number[] = [];
    for (let i = 0; i < header.length; i++) {
      if ((header[i] || "").includes("box")) boxCols.push(i);
      if ((header[i] || "").includes("imei") || (header[i] || "").includes("serial")) imeiCols.push(i);
    }
    for (const b of boxCols) {
      const nearest = imeiCols
        .map((c) => ({ c, d: Math.abs(c - b) }))
        .sort((a, z) => a.d - z.d)[0];
      if (nearest) pairs.push({ boxCol: b, imeiCol: nearest.c });
    }
  }

  // uniq
  const seen = new Set<string>();
  return pairs.filter((p) => {
    const k = `${p.boxCol}-${p.imeiCol}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // auth consistency (même si pas utilisé ici)
    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    // ✅ import xlsx dynamique (safe Vercel)
    const XLSX = await import("xlsx");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
    }) as any[][];

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    const headerRowIdx = detectHeaderRow(rows);
    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect header row (need Box + IMEI headers)" },
        { status: 400 }
      );
    }

    const header = (rows[headerRowIdx] || []).map((x) => norm(x));
    const pairs = detectPairs(header);

    if (!pairs.length) {
      return NextResponse.json({ ok: false, error: "Missing required columns (Box No + IMEI)" }, { status: 400 });
    }

    // bucket: canonical|boxNo
    const buckets = new Map<
      string,
      { device: string; canonical: string; box_no: string; imeis: string[] }
    >();

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      for (const p of pairs) {
        const boxVal = row[p.boxCol];
        const imeiVal = row[p.imeiCol];

        const info = extractDeviceAndBoxNr(boxVal);
        if (!info) continue;

        if (!looksLikeImei(imeiVal)) continue;

        const imei = String(imeiVal ?? "").replace(/\s+/g, "");
        const key = `${info.canonical}|${info.boxNo}`;

        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, { device: info.deviceDisplay, canonical: info.canonical, box_no: info.boxNo, imeis: [imei] });
        } else {
          existing.imeis.push(imei);
        }
      }
    }

    const labels = Array.from(buckets.values())
      .map((b) => ({
        device: b.device,
        canonical_name: b.canonical,
        box_no: b.box_no,
        qty: b.imeis.length,
        // QR data = IMEI only, 1 per line (comme tu veux)
        qr_data: b.imeis.join("\n"),
      }))
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        { ok: false, error: "No valid rows parsed. Check Box No format + IMEI values." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      header_row_index: headerRowIdx,
      detected_pairs: pairs,
      labels,
      stats: {
        devices_detected: new Set(labels.map((x) => x.device)).size,
        cartons: labels.length,
        imei_total: labels.reduce((acc, x) => acc + Number(x.qty || 0), 0),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
