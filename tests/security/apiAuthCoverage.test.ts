import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForApi } from "../../lib/access-control";

const API_ROOT = join(process.cwd(), "app", "api");

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return findRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API authentication coverage", () => {
  it("maps every API method to an explicit access policy", () => {
    const missingPolicies = findRouteFiles(API_ROOT).flatMap((route) => {
      const source = readFileSync(route, "utf8");
      const methods = Array.from(
        source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g),
        (match) => match[1]
      );
      const relative = route
        .slice(API_ROOT.length)
        .replace(/\/route\.ts$/, "")
        .replaceAll("\\", "/");
      const pathname = `/api${relative}`;

      return methods
        .filter((method) => {
          const policy = permissionsForApi(pathname, method);
          return policy !== null && policy.length === 0;
        })
        .map((method) => `${method} ${pathname}`);
    });

    expect(missingPolicies).toEqual([]);
  });

  it("keeps the only middleware exception protected by CRON_SECRET", () => {
    const cron = readFileSync(
      join(API_ROOT, "cron", "low-stock", "route.ts"),
      "utf8"
    );

    expect(permissionsForApi("/api/cron/low-stock", "GET")).toBeNull();
    expect(cron).toContain("isCronRequestAuthorized");
    expect(cron).toContain("CRON_SECRET");
  });
});
