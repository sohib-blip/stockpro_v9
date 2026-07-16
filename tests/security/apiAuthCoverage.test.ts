import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const API_ROOT = join(process.cwd(), "app", "api");
const AUTH_MARKERS = [
  "requireUserFromBearer",
  "auth.getUser",
  "getSession",
  "CRON_SECRET",
  "authorization",
];

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return findRouteFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API authentication coverage", () => {
  it("does not allow the unauthenticated-route baseline to grow", () => {
    const routesWithoutAuth = findRouteFiles(API_ROOT).filter((route) => {
      const source = readFileSync(route, "utf8");
      return !AUTH_MARKERS.some((marker) => source.includes(marker));
    });

    // Existing debt recorded in docs/SECURITY_AUDIT.md. Reduce this number as
    // routes are migrated; a new unprotected route must never increase it.
    expect(routesWithoutAuth.length).toBeLessThanOrEqual(63);
  });
});
