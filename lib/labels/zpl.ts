// lib/labels/zpl.ts
function sanitizeZplText(value: unknown) {
  return String(value ?? "")
    .replace(/[\^~]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeZplQrPayload(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map(sanitizeZplText)
    .filter(Boolean)
    .join("\n");
}

export function zplForBoxLabel(opts: { device: string; box_no: string; qty: number; qr_payload: string }) {
  // ZD220-friendly layout with large text and a centered QR code.
  // qr_payload contains one IMEI per line.
  const device = sanitizeZplText(opts.device);
  const box_no = sanitizeZplText(opts.box_no);
  const qty = Number.isFinite(opts.qty) ? Math.max(0, Math.trunc(opts.qty)) : 0;
  const payload = sanitizeZplQrPayload(opts.qr_payload);

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
