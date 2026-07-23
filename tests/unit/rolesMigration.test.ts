import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260716_add_roles_and_api_permissions.sql"
  ),
  "utf8"
).toLowerCase();

describe("roles and API permissions migration", () => {
  it("adds every new module permission", () => {
    for (const column of [
      "can_returns",
      "can_accessories",
      "can_supply",
      "can_nrd",
      "can_alerts",
    ]) {
      expect(migration).toContain(`add column if not exists ${column}`);
    }
  });

  it("limits role values and creates private permission helpers", () => {
    expect(migration).toContain("'admin', 'operator', 'viewer'");
    expect(migration).toContain("function private.has_app_role");
    expect(migration).toContain("function private.has_permission");
    expect(migration).toContain("security definer");
  });

  it("replaces direct write policies with permission checks", () => {
    expect(migration).toContain("create policy bins_permission_write");
    expect(migration).toContain("create policy boxes_permission_update");
    expect(migration).toContain("create policy thresholds_permission_write");
  });
});
