// app/api/inbound/commit/route.ts
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

// helpers types from vendorParser
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

/* =========================
   Supabase helpers
========================= */
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    "";

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function authedClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/* =========================
   Types
========================= */
type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";

type ParsedLabel = {
  vendor: Vendor;
  device: string; // display device
  box_no: string; // master boxnr
  qty: number;
  imeis: string[];
  qr_data: string; // imei only (one per line)
};

type ParserOk = {
  ok: true;
  labels: ParsedLabel[];
  counts: { devices: number; boxes: number; items: number };
  debug?: any;
};

type ParserFail = {
  ok: false;
  error: string;
  unknown_devices?: string[];
  debug?: any;
};

type ParserResult = ParserOk | ParserFail;

/* =========================
   Schema-safe insert inbound_imports
========================= */
async function safeInsertInboundImport(admin: any, payload: Record<string, any>) {
  const tries: Record<string, any>[] = [];

  const drop = (obj: any, keys: string[]) => {
    const o = { ...obj };
    for (const k of keys) delete o[k];
    return o;
  };

  // from most complete → minimal
  tries.push({ ...payload });
  tries.push(drop(payload, ["created_by_email"]));
  tries.push(drop(payload, ["created_by_email", "devices"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location", "vendor"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location", "vendor", "format"]));
  tries.push(drop(payload, ["created_by_email", "devices", "location", "vendor", "format", "file_name"]));
  tries.push({}); // last resort

  for (const t of tries) {
    const res = await admin.from("inbound_imports").insert(t as any).select("*").maybeSingle();
    if (!res.error) return res.data;
  }

  return null;
}

/* =========================
   Boxes upsert + map box_id
========================= */
async function upsertBoxesAndMap(admin: any, labels: ParsedLabel[], location: string) {
  // Create unique rows per (device, box_no)
  const uniqMap = new Map<string, any>();
  for (const l of labels) {
    const k = `${l.device}__${l.box_no}`;
    if (!uniqMap.has(k)) {
      uniqMap.set(k, {
        device: l.device,
        box_no: l.box_no,
        master_box_no: l.box_no, // if your schema has it
        location,
        status: "IN_STOCK",
      });
    }
  }

  const rows = Array.from(uniqMap.values());

  // Try upsert strategies
  // 1) conflict on device,master_box_no
  {
    const res = await admin
      .from("boxes")
      .upsert(rows as any, { onConflict: "device,master_box_no" })
      .select("box_id, device, box_no, master_box_no");
    if (!res.error) {
      const map = new Map<string, string>();
      for (const r of res.data || []) {
        const dev = String(r.device ?? "");
        const b = String(r.master_box_no ?? r.box_no ?? "");
        map.set(`${dev}__${b}`, String(r.box_id));
      }
      return map;
    }
  }

  // 2) conflict on device,box_no
  {
    const res = await admin
      .from("boxes")
      .upsert(
        rows.map((x: any) => {
          const y = { ...x };
          delete y.master_box_no; // in case it doesn't exist
          return y;
        }) as any,
        { onConflict: "device,box_no" }
      )
      .select("box_id, device, box_no");
    if (!res.error) {
      const map = new Map<string, string>();
      for (const r of res.data || []) {
        const dev = String(r.device ?? "");
        const b = String(r.box_no ?? "");
        map.set(`${dev}__${b}`, String(r.box_id));
      }
      return map;
    }
  }

  // 3) fallback: insert row by row (ignore duplicates), then fetch
  for (const r of rows) {
    // try insert with master_box_no first
    let ins = await admin.from("boxes").insert(r as any);
    if (ins.error) {
      // retry without master_box_no
      const rr = { ...r };
      delete (rr as any).master_box_no;
      ins = await admin.from("boxes").insert(rr as any);
      // ignore duplicate errors
    }
  }

  // Fetch to build map (try with master_box_no, else box_no)
  const devices = Array.from(new Set(rows.map((r) => r.device)));
  const boxNos = Array.from(new Set(rows.map((r) => r.box_no)));

  // try fetch master_box_no
  {
    const f = await admin
      .from("boxes")
      .select("box_id, device, master_box_no, box_no")
      .in("device", devices)
      .in("box_no", boxNos);

    if (!f.error) {
      const map = new Map<string, string>();
      for (const r of f.data || []) {
        const dev = String(r.device ?? "");
        const b = String(r.master_box_no ?? r.box_no ?? "");
        map.set(`${dev}__${b}`, String(r.box_id));
      }
      return map;
    }
  }

  return new Map<string, string>();
}

/* =========================
   Insert IMEIs into items
========================= */
async function insertImeis(admin: any, labels: ParsedLabel[], boxIdMap: Map<string, string>) {
  // Build rows for items table
  const rows: any[] = [];
  for (const l of labels) {
    const box_id = boxIdMap.get(`${l.device}__${l.box_no}`);
    if (!box_id) continue;

    // dedup imeis already
    const seen = new Set<string>();
    for (const imei of l.imeis || []) {
      if (!imei) continue;
      if (seen.has(imei)) continue;
      seen.add(imei);

      rows.push({
        box_id,
        imei,
        status: "IN_STOCK",
      });
    }
  }

  if (!rows.length) return { inserted: 0, table: "items" };

  // Try bulk insert items
  {
    const res = await admin.from("items").insert(rows as any);
    if (!res.error) return { inserted: rows.length, table: "items" };
  }

  // fallback: try box_items
  {
    const rows2 = rows.map((r) => ({ box_id: r.box_id, imei: r.imei }));
    const res = await admin.from("box_items").insert(rows2 as any);
    if (!res.error) return { inserted: rows2.length, table: "box_items" };
  }

  // last fallback: insert one by one into items ignoring duplicates
  let inserted = 0;
  for (const r of rows) {
    const ins = await admin.from("items").insert(r as any);
    if (!ins.error) inserted++;
  }
  return { inserted, table: "items" };
}

/* =========================
   POST /api/inbound/commit
========================= */
export async function POST(req: Request) {
  try {
    /* ---------- Auth ---------- */
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Bearer token" }, { status: 401 });
    }

    const userClient = authedClient(token);
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const created_by_email = userData.user?.email || null;

    /* ---------- FormData ---------- */
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const vendor = form.get("vendor") as Vendor | null;
    const format = String(form.get("format") || "");
    const location = String(form.get("location") || "").trim();

    if (!file || !vendor) {
      return NextResponse.json({ ok: false, error: "Missing file or vendor" }, { status: 400 });
    }

    /* ---------- Read Excel ---------- */
    const bytes = new Uint8Array(await file.arrayBuffer());
    const workbook = XLSX.read(bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as any[][];

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "Empty Excel file" }, { status: 400 });
    }

    /* ---------- Load devices DB ---------- */
    const admin = adminClient();
    if (!admin) {
      return NextResponse.json({ ok: false, error: "Server misconfiguration (missing service key)" }, { status: 500 });
    }

    const { data: devicesDbRows, error: devErr } = await admin
      .from("devices")
      .select("canonical_name, device, active");

    if (devErr) {
      return NextResponse.json({ ok: false, error: devErr.message }, { status: 500 });
    }

    const devicesDb = toDeviceMatchList((devicesDbRows || []) as any);

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
        return NextResponse.json({ ok: false, error: "Unsupported vendor" }, { status: 400 });
    }

    /* ---------- Parser error ---------- */
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    const labels = result.labels || [];

    /* ---------- Upsert boxes + insert IMEIs ---------- */
    const boxIdMap = await upsertBoxesAndMap(admin, labels, location);

    const insertRes = await insertImeis(admin, labels, boxIdMap);

    /* ---------- Save inbound_imports history (schema-safe) ---------- */
    const importRow = await safeInsertInboundImport(admin, {
      file_name: file.name,
      vendor,
      format,
      location,
      devices: result.counts.devices,
      boxes: result.counts.boxes,
      items: result.counts.items,
      created_by_email,
    });

    /* ---------- Return labels with box_id ---------- */
    const labelsWithBoxId = labels.map((l) => ({
      device: l.device,
      box_no: l.box_no,
      qty: l.qty,
      qr_data: l.qr_data,
      box_id: boxIdMap.get(`${l.device}__${l.box_no}`) || null,
    }));

    return NextResponse.json({
      ok: true,
      vendor,
      format,
      location,
      file_name: file.name,
      import: importRow ?? null,
      devices: result.counts.devices,
      boxes: result.counts.boxes,
      items: result.counts.items,
      inserted_into: insertRes.table,
      inserted_items: insertRes.inserted,
      labels: labelsWithBoxId,
      debug: result.debug ?? null,
    });
  } catch (e: any) {
    console.error("Inbound commit error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}