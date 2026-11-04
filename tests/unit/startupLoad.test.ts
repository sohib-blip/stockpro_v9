/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase query-builder stand-ins */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  sessionActive: true as boolean,
}));

// Records the order of the access-control round trips.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        mocks.events.push("getUser:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        mocks.events.push("getUser:end");
        return { data: { user: { id: "user-1", email: "a@example.test" } }, error: null };
      },
    },
    rpc: async () => {
      mocks.events.push("touch:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      mocks.events.push("touch:end");
      return { data: mocks.sessionActive, error: null };
    },
    from: (table: string) => {
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          mocks.events.push(`${table}:start`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          mocks.events.push(`${table}:end`);
          return {
            data: table === "user_roles" ? { role: "operator" } : { can_nrd: true },
            error: null,
          };
        },
      };
      return query;
    },
  }),
}));

import { authorizeApiRequest } from "../../lib/auth";
import {
  NRD_READ_SYNC_INTERVAL_MS,
  resetNrdReadSyncs,
  syncNrdForReader,
} from "../../lib/nrd-sync";
import { brusselsInstant, nrdTaskStopsAt } from "../../lib/nrd-time";

function read(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

function bearerRequest() {
  const payload = Buffer.from(JSON.stringify({ session_id: "session-1" })).toString("base64url");
  return new Request("https://stockpro.test/api/nrd/current", {
    headers: { Authorization: `Bearer header.${payload}.signature` },
  });
}

// Supabase stand-in for nrd-sync: every query is empty; counts the queries.
function countingSupabase(options: { fail?: boolean } = {}) {
  const counter = { queries: 0 };
  const client: any = {
    from: () => {
      counter.queries += 1;
      const query: any = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve(
            options.fail
              ? { data: null, error: new Error("database unavailable") }
              : { data: [], error: null }
          ),
      };
      return query;
    },
  };
  return { client, counter };
}

describe("access control round trips", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.sessionActive = true;
  });

  it("verifies the token first, then checks the session and permissions side by side", async () => {
    const result = await authorizeApiRequest(bearerRequest(), ["can_nrd"]);
    expect(result.ok).toBe(true);

    const order = mocks.events;
    expect(order.slice(0, 2)).toEqual(["getUser:start", "getUser:end"]);
    // Both lookups start before either finishes.
    const firstEnd = order.findIndex((event, index) => index > 1 && event.endsWith(":end"));
    const startsBeforeFirstEnd = order.slice(2, firstEnd).filter((event) => event.endsWith(":start"));
    expect(startsBeforeFirstEnd).toEqual(
      expect.arrayContaining(["touch:start", "user_roles:start", "user_permissions:start"])
    );
  });

  it("still refuses a replaced session even though permissions were read", async () => {
    mocks.sessionActive = false;
    const result = await authorizeApiRequest(bearerRequest(), ["can_nrd"]);
    expect(result).toMatchObject({ ok: false, status: 401, error: "Session expired or replaced" });
  });
});

describe("NRD sync for read routes", () => {
  beforeEach(() => resetNrdReadSyncs());
  afterEach(() => vi.restoreAllMocks());

  it("syncs a user at most once a minute", async () => {
    const { client, counter } = countingSupabase();
    const now = new Date("2026-11-04T10:00:00Z");

    expect(await syncNrdForReader(client, "Ops@Example.test", now)).toBe(true);
    const afterFirst = counter.queries;
    expect(afterFirst).toBeGreaterThan(0);

    const later = new Date(now.getTime() + NRD_READ_SYNC_INTERVAL_MS - 1);
    expect(await syncNrdForReader(client, "ops@example.test", later)).toBe(false);
    expect(counter.queries).toBe(afterFirst);

    const minuteLater = new Date(now.getTime() + NRD_READ_SYNC_INTERVAL_MS);
    expect(await syncNrdForReader(client, "ops@example.test", minuteLater)).toBe(true);
    expect(counter.queries).toBeGreaterThan(afterFirst);
  });

  it("keeps users apart and syncs anyway when forced", async () => {
    const { client, counter } = countingSupabase();
    const now = new Date("2026-11-04T10:00:00Z");

    await syncNrdForReader(client, "a@example.test", now);
    expect(await syncNrdForReader(client, "b@example.test", now)).toBe(true);
    const before = counter.queries;
    expect(await syncNrdForReader(client, "a@example.test", now, { force: true })).toBe(true);
    expect(counter.queries).toBeGreaterThan(before);
  });

  it("shares one sync between simultaneous reads", async () => {
    const { client, counter } = countingSupabase();
    const now = new Date("2026-11-04T10:00:00Z");

    const results = await Promise.all([
      syncNrdForReader(client, "a@example.test", now),
      syncNrdForReader(client, "a@example.test", now),
      syncNrdForReader(client, "a@example.test", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    resetNrdReadSyncs();
    const single = countingSupabase();
    await syncNrdForReader(single.client, "a@example.test", now);
    expect(counter.queries).toBe(single.counter.queries);
  });

  it("retries on the next read after a failed sync", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = countingSupabase({ fail: true });
    const now = new Date("2026-11-04T10:00:00Z");

    await syncNrdForReader(failing.client, "a@example.test", now);
    expect(await syncNrdForReader(failing.client, "a@example.test", now)).toBe(true);
  });
});

describe("NRD stop time", () => {
  it("stops at 17:00 Belgian time of the start day", () => {
    const started = brusselsInstant("2026-11-04", "09:00");
    expect(nrdTaskStopsAt(started)).toEqual({
      at: brusselsInstant("2026-11-04", "17:00"),
      endsWithSchedule: false,
    });
  });

  it("stops at the end of a scheduled slot before 17:00, never after", () => {
    const started = brusselsInstant("2026-11-04", "09:00");
    const slotEnd = brusselsInstant("2026-11-04", "11:30");
    expect(nrdTaskStopsAt(started, slotEnd)).toEqual({ at: slotEnd, endsWithSchedule: true });

    const lateSlot = brusselsInstant("2026-11-04", "18:00");
    expect(nrdTaskStopsAt(started, lateSlot).at).toEqual(brusselsInstant("2026-11-04", "17:00"));
  });
});

describe("startup requests", () => {
  it("loads the signed-in user and access once", () => {
    const provider = read("components", "AccessProvider.tsx");
    expect(provider.match(/auth\.getUser\(\)/g)).toHaveLength(1);
    expect(provider).toContain('event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED"');
    expect(provider).toContain("pendingRefresh.current");
  });

  it("checks the NRD banner every 30 s, only while the tab is visible", () => {
    const shell = read("components", "AppShell.tsx");
    expect(shell).not.toContain("auth.getUser");
    expect(shell).not.toContain("setInterval(loadUserAndNrd, 5000)");
    expect(shell).toContain("const NRD_POLL_INTERVAL_MS = 30_000;");
    expect(shell).toContain('if (document.visibilityState === "hidden") return;');
    expect(shell).toContain('document.addEventListener("visibilitychange", handleVisibility)');
    expect(shell).toContain("nrdTaskStopsAt(");
  });

  it("reuses the signed-in user on pages instead of asking Supabase again", () => {
    for (const page of ["accessories", "supply", "inbound", "returns", "outbound", "nrd"]) {
      expect(read("app", "(app)", page, "page.tsx")).not.toContain("auth.getUser");
    }
  });

  it("throttles only the NRD read routes", () => {
    for (const route of ["current", "history", "stats"]) {
      expect(read("app", "api", "nrd", route, "route.ts")).toContain("syncNrdForReader");
    }
    for (const route of ["start", "stop", "schedules", "export"]) {
      const source = read("app", "api", "nrd", route, "route.ts");
      expect(source).toContain("trySyncNrdForUser");
      expect(source).not.toContain("syncNrdForReader");
    }
  });
});
