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

function norm(v: any) {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function safeIncludes(v: any, needle: string) {
  return String(v ?? "").includes(needle);
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });

    // keep auth consistent (even if not used)
    authedClient(token);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(bytes, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];
    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty excel file" }, { status: 400 });
    }

    // Find likely header row
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] || [];
      const cells = row.map((x) => norm(x));
      const hasImei = cells.some((c) => safeIncludes(c, "imei"));
      const hasBox = cells.some((c) => safeIncludes(c, "box"));
      if (hasImei && hasBox) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx < 0) {
      return NextResponse.json(
        { ok: false, error: "Could not detect header row (no IMEI/BOX headers found)" },
        { status: 400 }
      );
    }

    const header = (rows[headerRowIdx] || []).map((x) => norm(x));

    // Find IMEI columns
    const imeiCols: number[] = [];
    for (let i = 0; i < header.length; i++) {
      if (safeIncludes(header[i], "imei")) imeiCols.push(i);
    }

    if (imeiCols.length === 0) {
      return NextResponse.json({ ok: false, error: "No IMEI column detected" }, { status: 400 });
    }

    // For each IMEI col, find nearby BOX columns to the left
    const groups = imeiCols.map((iIdx) => {
      const candidates: number[] = [];
      for (let c = Math.max(0, iIdx - 12); c <= iIdx; c++) {
        if (safeIncludes(header[c], "box")) candidates.push(c);
      }
      return {
        imeiCol: iIdx,
        boxCols: candidates.slice(0, 2), // in your file: 2x "Box No."
      };
    });

    // Try detect device/model/type column (optional)
    const deviceCol = header.findIndex((c) => safeIncludes(c, "device") || safeIncludes(c, "model") || safeIncludes(c, "type"));

    return NextResponse.json({
      ok: true,
      file_name: file.name,
      header_row_index: headerRowIdx,
      detected: {
        imei_cols: imeiCols,
        device_col: deviceCol >= 0 ? deviceCol : null,
        groups,
      },
      note: "Preview endpoint safe-fixed (no undefined.includes crash).",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}

