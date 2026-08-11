import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeUserAgent } from "../../lib/security/user-agent";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260722_add_connection_security_log.sql"
  ),
  "utf8"
);

describe("connection security log", () => {
  it("recognizes common browsers and device families without storing extra fingerprinting data", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
      )
    ).toEqual({
      browser: "Google Chrome",
      operatingSystem: "macOS",
      device: "Computer",
    });

    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toEqual({
      browser: "Safari",
      operatingSystem: "iOS / iPadOS",
      device: "Mobile",
    });
  });

  it("keeps connection metadata private from browser database roles", () => {
    expect(migration).toContain("alter table public.connection_events enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant all privileges on table public.connection_events to service_role");
    expect(migration).not.toContain("latitude");
    expect(migration).not.toContain("longitude");
  });
});
