import { afterEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}));
vi.mock("@/lib/cron/lowStockPolicy", async () =>
  import("../../lib/cron/lowStockPolicy")
);
vi.mock("@/lib/cron/lowStockEmail", async () =>
  import("../../lib/cron/lowStockEmail")
);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  createClient.mockReset();
});

describe("low-stock cron route", () => {
  it("rejects a missing server secret before privileged work or email", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    const { GET } = await import("../../app/api/cron/low-stock/route");

    const response = await GET(
      new Request("https://stockpro.test/api/cron/low-stock")
    );

    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("allows the exact scheduler token and preserves the disabled-email exit", async () => {
    vi.stubEnv("CRON_SECRET", "scheduler-secret");
    vi.stubEnv("ENABLE_LOW_STOCK_EMAILS", "false");
    createClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });
    const { GET } = await import("../../app/api/cron/low-stock/route");

    const response = await GET(
      new Request("https://stockpro.test/api/cron/low-stock", {
        headers: { Authorization: "Bearer scheduler-secret" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: true });
    expect(createClient).toHaveBeenCalledOnce();
  });
});
