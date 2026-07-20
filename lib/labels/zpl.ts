// lib/labels/zpl.ts
export function zplForBoxLabel(opts: { device: string; box_no: string; qty: number; qr_payload: string }) {
  // ZD220-friendly layout with large text and a centered QR code.
  // qr_payload contains one IMEI per line.
  const { device, box_no, qty, qr_payload } = opts;

  // Escape ZPL control characters when required.
  const payload = String(qr_payload || "").replace(/\^/g, " ").trim();

  return `
^XA
^PW600
^LL800
^CI28

^FO30,30^A0N,45,45^FD${device}^FS

^FO60,110^BQN,2,8^FDLA,${payload}^FS

^FO30,600^A0N,40,40^FDBOX: ${box_no}^FS
^FO30,660^A0N,35,35^FDIMEI: ${qty}^FS

^XZ
`.trim();
}
