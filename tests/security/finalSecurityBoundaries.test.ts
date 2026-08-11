import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migrationPath = join(
  root,
  "supabase/migrations/20260723210000_close_remaining_security_boundaries.sql"
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";

describe("remaining security boundaries", () => {
  it("updates role and permissions atomically while protecting the last admin", () => {
    const route = read("app/api/admin/users/route.ts");

    expect(migration).toContain("function public.save_user_access(");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("the last administrator cannot be removed");
    expect(migration).toContain("insert into public.user_roles");
    expect(migration).toContain("insert into public.user_permissions");
    expect(migration).toContain("to service_role");
    expect(route).toContain('.rpc("save_user_access"');
    expect(route).not.toContain('.from("user_roles")\n    .upsert');
    expect(route).not.toContain('.from("user_permissions")\n    .upsert');
  });

  it("binds every protected API request to an active signed auth session", () => {
    const auth = read("lib/auth.ts");
    const login = read("app/api/auth/login/route.ts");
    const takeover = read("app/api/auth/connection-event/route.ts");
    const stagingSmoke = read("scripts/staging-security-smoke.mjs");

    expect(migration).toContain("function public.activate_app_session(");
    expect(migration).toContain("function public.touch_app_session(");
    expect(migration).toContain("function public.take_over_app_session(");
    expect(migration).toContain("function public.end_app_session(");
    expect(migration).toContain("function private.has_active_app_session(");
    expect(migration).toContain("auth.jwt() ->> 'session_id'");
    expect(migration).toContain("interval '1 hour'");
    expect(migration).toContain("revoke insert, update on table public.profiles");
    expect(auth).toContain('"touch_app_session"');
    expect(login).toContain("sessionIdFromAccessToken");
    expect(login).toContain("activateAppSession");
    expect(takeover).toContain("takeOverAppSession");
    expect(stagingSmoke).toContain('previewFetch("/api/auth/login"');
    expect(stagingSmoke).not.toContain("signInWithPassword");
  });

  it("keeps all new session mutation RPCs private to the service role", () => {
    for (const signature of [
      "activate_app_session(uuid, text, text)",
      "touch_app_session(uuid, text)",
      "take_over_app_session(uuid, text, uuid)",
      "end_app_session(uuid, text)",
      "save_user_access(uuid, text, jsonb)",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${signature}`
      );
      expect(migration).toContain(
        `grant execute on function public.${signature} to service_role`
      );
    }
  });
});
