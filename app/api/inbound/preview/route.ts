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

function digitsOnly(v: any) {
  return String(v ?? "").replace(/\D/g, "");
}

function isImei(v: any) {
  const d = digitsOnly(v);
  return d.length === 15 ? d : "";
}

// Detects strings like:
// "FMB140BTZ9FD-076-004"
// "FMB 140BTZ9FD-076-004"
// "FMC234WC5XWU-026-002"
function isBoxLike(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  const noSpaces = s.replace(/\s+/g, "");
  return /-[0-9]{3}-[0-9]{3}$/.test(noSpaces) && /^[A-Za-z]{2,6}\s*\d{2,4}/.test(s);
}

function parseDeviceAndMasterBox(v: any): { canonical: string; device: string; masterbox: string } | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;

  const noSpaces = raw.replace(/\s+/g, ""); // remove spaces

  const boxMatch = noSpaces.match(/-(\d{3})-(\d{3})$/);
  if (!boxMatch) return null;
  const masterbox = `${boxMatch[1]}-${boxMatch[2]}`;

  const prefix = noSpaces.split("-")[0] || ""; // e.g. FMB140BTZ9FD
  const m = prefix.match(/^([A-Za-z]+)(\d+)/);
  if (!m) return null;

  const letters = m[1].toUpperCase();
  const digits = m[2];
  const canonical = `${letters}${digits}`; // FMB140
  const device = `${letters} ${digits}`;   // FMB 140

  return { canonical, device, masterbox };
}

type Group = {
  canonical: string;
  device: string;
  masterbox: string;
  imeis: Set<string>;
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // keep auth consistent (preview doesn't write to DB)
    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const XLSX = await import("xlsx");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return NextResponse.json({ ok: false, error: "No sheet found" }, { status: 400 });

    // defval "" keeps layout stable even when blanks exist
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }) as any[][];
    if (!grid || grid.length === 0) return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });

    const groups = new Map<string, Group>();

    // For each column, remember the last seen (device+masterbox) so blanks below still attach
    // This is CRUCIAL for your file where box cell appears once then blank.
    const lastContextPerCol = new Map<number, { canonical: string; device: string; masterbox: string }>();

    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];

        // 1) Update context if this cell looks like a box cell
        if (isBoxLike(cell)) {
          const parsed = parseDeviceAndMasterBox(cell);
          if (parsed) lastContextPerCol.set(c, parsed);
        }

        // 2) If cell is IMEI, attach it to nearest context on the left (or same column context)
        const imei = isImei(cell);
        if (!imei) continue;

        // Try same column first
        let ctx = lastContextPerCol.get(c) || null;

        // If not, search left up to 12 columns for a context (handles layout shifts)
        if (!ctx) {
          for (let k = c - 1; k >= Math.max(0, c - 12); k--) {
            const candidate = lastContextPerCol.get(k);
            if (candidate) {
              ctx = candidate;
              break;
            }
          }
        }

        if (!ctx) continue;

        const key = `${ctx.canonical}|${ctx.masterbox}`;
        if (!groups.has(key)) {
          groups.set(key, {
            canonical: ctx.canonical,
            device: ctx.device,
            masterbox: ctx.masterbox,
            imeis: new Set<string>(),
          });
        }
        groups.get(key)!.imeis.add(imei);
      }
    }

    const labels = Array.from(groups.values())
      .map((g) => ({
        device: g.device,
        canonical_name: g.canonical,
        box_no: g.masterbox,               // master big box
        qty: g.imeis.size,
        qr_data: Array.from(g.imeis).join("\n"), // ✅ IMEI only, 1 per line
      }))
      .sort((a, b) => (a.canonical_name + a.box_no).localeCompare(b.canonical_name + b.box_no));

    if (!labels.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No valid rows parsed. I need cells like FMB140xxxx-076-004 (or with spaces) and IMEI (15 digits) anywhere in the sheet.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      labels,
      stats: {
        devices_detected: new Set(labels.map((l) => l.device)).size,
        cartons: labels.length,
        imei_total: labels.reduce((acc, l) => acc + Number(l.qty || 0), 0),
      },
      note: "Sheet scanned cell-by-cell. Box context carried per column; IMEIs attached to nearest left context.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}