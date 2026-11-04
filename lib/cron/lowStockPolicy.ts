import { createHash, timingSafeEqual } from "node:crypto";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isCronRequestAuthorized(
  authorizationHeader: string | null,
  cronSecret: string | undefined
): boolean {
  if (!cronSecret?.trim()) return false;

  if (authorizationHeader === null) return false;

  // Hash both sides so the comparison runs in constant time whatever the
  // length of the header sent by the caller.
  return timingSafeEqual(
    sha256(authorizationHeader),
    sha256(`Bearer ${cronSecret}`)
  );
}

export function areLowStockEmailsEnabled(
  emailFlag: string | undefined,
  vercelEnvironment: string | undefined
): boolean {
  if (emailFlag !== undefined) return emailFlag === "true";

  return vercelEnvironment === "production";
}
