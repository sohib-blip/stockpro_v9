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
});
