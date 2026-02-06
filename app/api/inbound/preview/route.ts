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

function looksLikeImei(v: any) {
  const s = String(v ?? "").replace(/\s+/g, "");
  return /^\d{14,16}$/.test(s);
}

function extractDeviceAndBoxNr(raw: any): { deviceDisplay: string; canonical: string; boxNo: string } | null {
  const s0 = String(raw ?? "").trim();
  if (!s0) return null;

  // Ex: "FMB 140BTZ9FD-076-004" ou "FMB140BTZ9FD-076-004"
  const s = s0.replace(/\s+/g, ""); // enlève espaces (important)

  const parts = s.split("-").filter(Boolean);
  if (parts.length < 3) return null;

  const last = parts[parts.length - 1];
  const prev = parts[parts.length - 2];

  // boxnr attendu: 076-004
  if (!/^\d+$/.test(last) || !/^\d+$/.test(prev)) return null;

  const boxNo = `${prev}-${last}`;

  // prefix device: avant le 1er "-" => ex "FMB140BTZ9FD"
  const prefix = parts[0] || "";
  if (!prefix) return null;

  // récup letters + digits au début => FMB + 140
  const m = prefix.match(/^([A-Za-z]+)(\d+)/);
  if (!m) return null;

  const letters = m[1].toUpperCase();
  const digits = m[2];

  const canonical = `${letters}${digits}`;      // FMB140
  const deviceDisplay = `${letters} ${digits}`; // FMB 140

  return { deviceDisplay, canonical, boxNo };
}

type Bucket = { device: string; canonical: string; box_no: string; imeis: string[] };

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // garde auth cohérent (même si preview ne touche pas DB)
    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const XLSX = await import("xlsx");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // defval "" => garde les vides pour ne pas “couper” les colonnes
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    // ✅ scan “data-driven”: pas besoin de headers
    const buckets = new Map<string, Bucket>();

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.length) continue;

      for (let c = 0; c < row.length; c++) {
        const info = extractDeviceAndBoxNr(row[c]);
        if (!info) continue;

        // cherche un IMEI dans les cellules proches (souvent à droite)
        let imei: string | null = null;

        // priorité: c+1..c+5
        for (let k = c + 1; k <= Math.min(row.length - 1, c + 6); k++) {
          if (looksLikeImei(row[k])) {
            imei = String(row[k]).replace(/\s+/g, "");
            break;
          }
        }

        // fallback: cherche dans toute la ligne si pas trouvé
        if (!imei) {
          for (let k = 0; k < row.length; k++) {
            if (looksLikeImei(row[k])) {
              imei = String(row[k]).replace(/\s+/g, "");
              break;
            }
          }
        }

        if (!imei) continue;

        const key = `${info.canonical}|${info.boxNo}`;
        const existing = buckets.get(key);
        if (!existing) {
          buckets.set(key, {
            device: info.deviceDisplay,
            canonical: info.canonical,
            box_no: info.boxNo,
            imeis: [imei],
          });
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
        qr_data: b.imeis.join("\n"), // ✅ IMEI only, 1 par ligne
      }))
      .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No valid rows parsed. I need cells like FMB140xxxx-076-004 (or with spaces) + a 15-digit IMEI somewhere on the same row.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      file_name: file.name,
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
