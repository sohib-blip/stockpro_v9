import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// parsers fournisseurs
import {
  parseTeltonikaExcel,
  parseQuicklinkExcel,
  parseTrusterExcel,
  parseDigitalMatterExcel,
} from "@/lib/inbound";

// helpers communs
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

/* =========================
   Supabase helpers
========================= */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false },
  });
}

function authedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false },
    }
  );
}

/* =========================
   Types
========================= */
type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

type ParsedLabel = {
  vendor: Vendor;
  device: string;
  box_no: string;
  qty: number;
  imeis: string[];
  qr_data: string;
};

type ParserResult =
  | {
      ok: true;
      labels: ParsedLabel[];
      counts: { devices: number; boxes: number; items: number };
      debug?: any;
    }
  | {
      ok: false;
      error: string;
      unknown_devices?: string[];
      debug?: any;
    };

/* =========================
   POST /api/inbound/preview
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing Bearer token" },
        { status: 401 }
      );
    }

    const userClient = authedClient(token);
    const { error: authErr } = await userClient.auth.getUser();
    if (authErr) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    /* ---------- FormData ---------- */
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = form.get("vendor") as Vendor | null;
    const format = String(form.get("format") || "");
    const location = String(form.get("location") || "").trim();

    if (!file || !vendor) {
      return NextResponse.json(
        { ok: false, error: "Missing file or vendor" },
        { status: 400 }
      );
    }

    /* ---------- Read Excel ---------- */
    const bytes = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
    }) as any[][];

    if (!rows.length) {
      return NextResponse.json(
        { ok: false, error: "Empty Excel file" },
        { status: 400 }
      );
    }

    /* ---------- Load devices DB ---------- */
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Server misconfiguration" },
        { status: 500 }
      );
    }

    const { data: devicesDbRows } = await admin
      .from("devices")
      .select("canonical_name, device, active");

    const devicesDb = toDeviceMatchList(devicesDbRows || []);

    /* ---------- Dispatch parser ---------- */
    let result: ParserResult;

    switch (vendor) {
      case "teltonika":
        result = parseTeltonikaExcel({
          rows,
          devicesDb,
          format,
          location,
        });
        break;

      case "quicklink":
        result = parseQuicklinkExcel({
          rows,
          devicesDb,
          location,
        });
        break;

      case "truster":
        result = parseTrusterExcel({
          rows,
          devicesDb,
          location,
        });
        break;

      case "digitalmatter":
        result = parseDigitalMatterExcel({
          rows,
          devicesDb,
          location,
        });
        break;

      default:
        return NextResponse.json(
          { ok: false, error: "Unsupported vendor" },
          { status: 400 }
        );
    }

    /* ---------- Return ---------- */
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      vendor,
      location,
      labels: result.labels.map((l) => ({
        device: l.device,
        box_no: l.box_no,
        qty: l.qty,
        qr_data: l.qr_data,
      })),
      counts: result.counts,
      debug: result.debug ?? null,
    });
  } catch (e: any) {
    console.error("Inbound preview error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}