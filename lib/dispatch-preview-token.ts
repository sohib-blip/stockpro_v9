import { createHmac, timingSafeEqual } from "node:crypto";
import type { DispatchOrder } from "@/lib/dispatch-planning";

export type DispatchPreviewTokenPayload = {
  version: 1;
  expiresAt: number;
  sourceHash: string;
  sourceFilename: string;
  sourceGeneratedAt: string | null;
  orders: DispatchOrder[];
};

let warnedAboutFallback = false;

// Dedicated signing secret. Until DISPATCH_PREVIEW_SECRET is set in an
// environment, previews keep being signed with the service-role key so that
// nothing breaks; a server log line reminds us to add the dedicated secret.
function secret() {
  const dedicated = process.env.DISPATCH_PREVIEW_SECRET;
  if (dedicated) return dedicated;
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!fallback) throw new Error("Dispatch preview signing secret is unavailable");
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "DISPATCH_PREVIEW_SECRET is not set: dispatch previews are signed with the service-role key"
    );
  }
  return fallback;
}

export function createDispatchPreviewToken(
  payload: Omit<DispatchPreviewTokenPayload, "version" | "expiresAt">
) {
  const complete: DispatchPreviewTokenPayload = {
    ...payload,
    version: 1,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(complete)).toString("base64url");
  const signature = createHmac("sha256", secret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyDispatchPreviewToken(token: string) {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new Error("Invalid dispatch preview");
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    // Also reached by a preview signed before the signing secret changed.
    throw new Error(
      "This dispatch preview is invalid or was made before an update. Refresh the preview before confirming."
    );
  }

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8")
  ) as DispatchPreviewTokenPayload;
  if (
    payload.version !== 1 ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt < Date.now() ||
    !/^[a-f0-9]{64}$/.test(payload.sourceHash) ||
    !Array.isArray(payload.orders) ||
    payload.orders.length === 0
  ) {
    throw new Error("Dispatch preview has expired or is invalid");
  }
  return payload;
}
