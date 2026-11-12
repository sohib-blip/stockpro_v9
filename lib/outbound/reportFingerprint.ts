import { createHash } from "node:crypto";

function digestToUuid(hexDigest: string) {
  const bytes = Buffer.from(hexDigest.slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Former key, from the file bytes: still checked so reports confirmed with it stay blocked. */
export function accessoryReportFingerprint(buffer: Buffer) {
  return createHash("sha256")
    .update("stockpro-accessory-eod-v1\0")
    .update(buffer)
    .digest("hex");
}
export function accessoryReportOperationId(buffer: Buffer) {
  return digestToUuid(accessoryReportFingerprint(buffer));
}

/**
 * Key from the report's content lines (see endOfDayReportContentLines): the
 * same report re-saved or re-exported gets the same key, so it is refused.
 */
export function accessoryReportContentFingerprint(contentLines: string[]) {
  const hash = createHash("sha256").update("stockpro-accessory-eod-content-v1\0");
  for (const line of [...contentLines].sort()) {
    hash.update(line).update("\n");
  }
  return hash.digest("hex");
}
export function accessoryReportContentOperationId(contentLines: string[]) {
  return digestToUuid(accessoryReportContentFingerprint(contentLines));
}
