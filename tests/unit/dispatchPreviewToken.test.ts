import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDispatchPreviewToken,
  verifyDispatchPreviewToken,
} from "../../lib/dispatch-preview-token";
import type { DispatchOrder } from "../../lib/dispatch-planning";

const saved = {
  dedicated: process.env.DISPATCH_PREVIEW_SECRET,
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function makeToken() {
  return createDispatchPreviewToken({
    sourceHash: "a".repeat(64),
    sourceFilename: "dispatch.xlsx",
    sourceGeneratedAt: null,
    orders: [{ orderId: "ORDER-1" } as unknown as DispatchOrder],
  });
}

function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

describe("dispatch preview signing secret", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    restore("DISPATCH_PREVIEW_SECRET", saved.dedicated);
    restore("SUPABASE_SERVICE_ROLE_KEY", saved.serviceRole);
    vi.restoreAllMocks();
  });

  it("signs with DISPATCH_PREVIEW_SECRET when it is set", () => {
    process.env.DISPATCH_PREVIEW_SECRET = "unit-test-dispatch-secret";
    const token = makeToken();
    const [encoded, signed] = token.split(".");
    expect(signed).toBe(signature(encoded, "unit-test-dispatch-secret"));
    expect(signed).not.toBe(signature(encoded, "unit-test-service-role"));
    expect(verifyDispatchPreviewToken(token).orders).toHaveLength(1);
  });

  it("rejects a preview signed with the service-role key once the dedicated secret exists", () => {
    delete process.env.DISPATCH_PREVIEW_SECRET;
    const legacy = makeToken();
    process.env.DISPATCH_PREVIEW_SECRET = "unit-test-dispatch-secret";
    expect(() => verifyDispatchPreviewToken(legacy)).toThrow(
      /made before an update\. Refresh the preview/
    );
  });

  it("falls back to the service-role key while the dedicated secret is missing", () => {
    delete process.env.DISPATCH_PREVIEW_SECRET;
    const token = makeToken();
    const [encoded, signed] = token.split(".");
    expect(signed).toBe(signature(encoded, "unit-test-service-role"));
    expect(verifyDispatchPreviewToken(token).sourceFilename).toBe("dispatch.xlsx");
  });

  it("refuses to sign when no secret is available", () => {
    delete process.env.DISPATCH_PREVIEW_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => makeToken()).toThrow("Dispatch preview signing secret is unavailable");
  });
});
