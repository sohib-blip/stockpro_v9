// lib/inbound/vendorParser.ts

export type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";

export type DevicesDbRow = {
  canonical_name: string;
  device: string | null;
  active?: boolean | null;
};

export type DeviceMatch = {
  canonical: string;
  display: string;
  active: boolean;
};

export type ParsedLabel = {
  vendor: Vendor;
  device: string;     // display name (comme dans Admin > Devices)
  box_no: string;     // master box no (gros carton)
  qty: number;
  imeis: string[];
  qr_data: string;    // ✅ IMEI only, 1 par ligne
};

export type ParseCounts = { devices: number; boxes: number; items: number };

export type ParseOk = {
  ok: true;
  labels: ParsedLabel[];
  unknown_devices: string[];
  debug: Record<string, any>;
  counts: ParseCounts;
};

export type ParseFail = {
  ok: false;
  error: string;
  unknown_devices: string[];
  debug: Record<string, any>;
};

export type ParseResult = ParseOk | ParseFail;

export function toDeviceMatchList(rows: DevicesDbRow[]): DeviceMatch[] {
  return (rows || []).map((d) => ({
    canonical: String(d.canonical_name || ""),
    display: String(d.device || d.canonical_name || ""),
    active: d.active !== false,
  }));
}

export function norm(v: any): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalize(s: any): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export function isImei(v: any): string | null {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

export function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * Smart match vers Admin > Devices:
 * - exact canonical
 * - raw startsWith db canonical (best)
 * - db startsWith raw
 * - padding num: FMC03 -> FMC003
 * - trim digits: FMC9202 -> FMC920 (si existe)
 */
export function resolveDeviceDisplay(
  rawDevice: string,
  devices: DeviceMatch[]
): string | null {
  const rawCanon = canonicalize(rawDevice);
  if (!rawCanon) return null;

  const list = (devices || []).filter((d) => d.active);

  const score = (dbCanon: string): number => {
    if (!dbCanon) return -1;

    if (rawCanon === dbCanon) return 1000;

    if (rawCanon.startsWith(dbCanon)) return 900 + dbCanon.length;

    if (dbCanon.startsWith(rawCanon)) return 700 + rawCanon.length;

    const m = rawCanon.match(/^([A-Z]+)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const num = m[2];
      const n = parseInt(num, 10);

      const pad3 = prefix + String(n).padStart(3, "0");
      if (pad3 === dbCanon) return 850;

      const trim3 = prefix + String(num).slice(0, 3);
      if (trim3 === dbCanon) return 840;

      const pad4 = prefix + String(n).padStart(4, "0");
      if (pad4 === dbCanon) return 830;
    }

    return -1;
  };

  let best: { display: string; s: number } | null = null;

  for (const d of list) {
    const s = score(d.canonical);
    if (s > (best?.s ?? -1)) best = { display: d.display, s };
  }

  return best?.s && best.s > 0 ? best.display : null;
}

export function computeCounts(labels: ParsedLabel[]): ParseCounts {
  const devices = new Set(labels.map((l) => l.device)).size;
  const boxes = labels.length;
  const items = labels.reduce((acc, l) => acc + (l.qty || 0), 0);
  return { devices, boxes, items };
}

export function makeFail(
  error: string,
  unknown_devices: string[],
  debug: Record<string, any>
): ParseFail {
  return {
    ok: false,
    error,
    unknown_devices: uniq(unknown_devices).sort(),
    debug: debug || {},
  };
}

export function makeOk(
  labels: ParsedLabel[],
  debug: Record<string, any>,
  unknown_devices: string[] = []
): ParseOk {
  const cleaned = (labels || [])
    .map((l) => {
      const imeis = uniq(l.imeis || []);
      const qtyFromInput = Number.isFinite(l.qty as any) ? Number(l.qty) : 0;
      const qty = qtyFromInput > 0 ? qtyFromInput : imeis.length;
      return {
        ...l,
        imeis,
        // ✅ If parser provided a qty, keep it. Otherwise default to imei count.
        // This prevents wrong totals when a vendor file represents quantities differently.
        qty,
        qr_data: imeis.join("\n"), // ✅ IMEI only
      };
    })
    .filter((l) => (Number(l.qty) || 0) > 0)
    .sort((a, b) => (a.device + a.box_no).localeCompare(b.device + b.box_no));

  return {
    ok: true,
    labels: cleaned,
    unknown_devices: uniq(unknown_devices).sort(),
    debug: debug || {},
    counts: computeCounts(cleaned),
  };
}