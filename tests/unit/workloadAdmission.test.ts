import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../../lib/auth", () => ({
  supabaseService: () => ({ rpc: mocks.rpc }),
}));

import { acquireWorkloadLease } from "../../lib/security/workload-budget";

describe("workload admission failure behavior", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    process.env.WORKLOAD_BUDGET_HASH_SECRET = "unit-test-budget-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed when shared admission state is unavailable", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "coordinator unavailable" },
    });

    const result = await acquireWorkloadLease(
      new Request("https://stockpro.test/api/auth/login"),
      "login",
      {
        principal: "operator@example.test",
        source: "192.0.2.10",
      }
    );

    expect(result).toEqual({
      ok: false,
      status: 503,
      reason: "budget_unavailable",
      retryAfterSeconds: 5,
    });
  });

  it("returns shared backpressure without exposing raw identity keys", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          allowed: false,
          lease_id: null,
          reason: "rate_limited",
          retry_after_seconds: 17,
        },
      ],
      error: null,
    });

    const result = await acquireWorkloadLease(
      new Request("https://stockpro.test/api/auth/login"),
      "login",
      {
        principal: "operator@example.test",
        source: "192.0.2.10",
      }
    );

    expect(result).toEqual({
      ok: false,
      status: 429,
      reason: "rate_limited",
      retryAfterSeconds: 17,
    });

    const parameters = mocks.rpc.mock.calls[0][1];
    expect(parameters.p_principal_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parameters.p_source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(parameters)).not.toContain("operator@example.test");
    expect(JSON.stringify(parameters)).not.toContain("192.0.2.10");
  });

  it("hashes with the dedicated secret and falls back to the service-role key", async () => {
    const digest = (secret: string) =>
      createHmac("sha256", secret).update("operator@example.test").digest("hex");
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: true, lease_id: "lease-1" }],
      error: null,
    });
    const savedServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = () =>
      acquireWorkloadLease(
        new Request("https://stockpro.test/api/auth/login"),
        "login",
        { principal: "operator@example.test", source: "192.0.2.10" }
      );

    try {
      process.env.SUPABASE_SERVICE_ROLE_KEY = "unit-test-service-role";
      await call();
      expect(mocks.rpc.mock.calls[0][1].p_principal_hash).toBe(
        digest("unit-test-budget-secret")
      );

      delete process.env.WORKLOAD_BUDGET_HASH_SECRET;
      await expect(call()).resolves.toEqual({ ok: true, leaseId: "lease-1" });
      expect(mocks.rpc.mock.calls[1][1].p_principal_hash).toBe(
        digest("unit-test-service-role")
      );
    } finally {
      if (savedServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = savedServiceRole;
    }
  });
});
