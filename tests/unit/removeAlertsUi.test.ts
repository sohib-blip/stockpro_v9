import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../../lib/access-control";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260716_remove_alerts_ui.sql"
  ),
  "utf8"
).toLowerCase();

describe("standalone Alerts removal", () => {
  it("removes the page and permission from the application", () => {
    expect(existsSync(join(process.cwd(), "app", "(app)", "alerts", "page.tsx"))).toBe(false);
    expect(PERMISSION_KEYS).not.toContain("can_alerts");
  });

  it("removes the obsolete write policy and permission column", () => {
    expect(migration).toContain("drop policy if exists thresholds_permission_write");
    expect(migration).toContain("drop column if exists can_alerts");
  });
});
