// lib/labels/zpl.ts
export function zplForBoxLabel(opts: { device: string; box_no: string; qty: number; qr_payload: string }) {
  // ZD220 friendly: simple, gros texte, QR centré
  // qr_payload = imei ligne par ligne
  const { device, box_no, qty, qr_payload } = opts;

  // échappe ^ et \ si besoin
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