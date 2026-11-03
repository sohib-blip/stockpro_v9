import { afterEach, describe, expect, it, vi } from "vitest";
import { permissionsForApi } from "../../lib/access-control";
import {
  checkSecurityUpdates,
  NPM_BULK_ADVISORY_URL,
  productionPackageVersions,
  summarizeAdvisories,
} from "../../lib/security-updates";

const { authorizeApiRequest, checkMock, audienceMock } = vi.hoisted(() => ({
  authorizeApiRequest: vi.fn(),
  checkMock: vi.fn(),
  audienceMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));
vi.mock("@/lib/auth", () => ({
  authorizeApiRequest,
  supabaseService: () => ({}),
}));
vi.mock("@/lib/security-alert-recipients", () => ({
  securityAlertAudience: audienceMock,
}));
vi.mock("@/lib/security-updates", async () => {
  const actual = await import("../../lib/security-updates");
  return { ...actual, checkSecurityUpdates: checkMock };
});
vi.mock("@/package-lock.json", () => ({
  default: {
    packages: {
      "": { name: "stockpro", version: "0.1.0" },
      "node_modules/next": { version: "14.2.10" },
    },
  },
}));

afterEach(() => {
  authorizeApiRequest.mockReset();
  checkMock.mockReset();
  audienceMock.mockReset();
});

const LOCKFILE = {
  packages: {
    "": { name: "stockpro", version: "0.1.0" },
    "node_modules/next": { version: "14.2.10" },
    "node_modules/zod": { version: "3.23.8" },
    "node_modules/@scope/tool": { version: "1.0.0", dev: true },
    "node_modules/@supabase/ssr": { version: "0.8.0" },
    "node_modules/glob/node_modules/minimatch": { version: "3.1.2" },
    "node_modules/minimatch": { version: "9.0.5" },
    "node_modules/local-workspace": { link: true, version: "1.0.0" },
    "node_modules/vitest": { version: "4.1.10", dev: true },
  },
};

describe("security update check", () => {
  it("lists only production packages with every installed version", () => {
    expect(productionPackageVersions(LOCKFILE)).toEqual({
      "@supabase/ssr": ["0.8.0"],
      minimatch: ["3.1.2", "9.0.5"],
      next: ["14.2.10"],
      zod: ["3.23.8"],
    });
  });

  it("summarizes npm advisories by package, worst severity first", () => {
    const installed = productionPackageVersions(LOCKFILE);
    const report = summarizeAdvisories(
      installed,
      {
        zod: [
          {
            id: 1,
            title: "Zod memory exhaustion",
            severity: "high",
            vulnerable_versions: "<4.6.6",
            url: "https://github.com/advisories/GHSA-zod",
          },
        ],
        next: [
          {
            id: 2,
            title: "Cache poisoning",
            severity: "moderate",
            vulnerable_versions: "<14.2.31",
            url: "https://github.com/advisories/GHSA-a",
          },
          {
            id: 3,
            title: "Middleware authorization bypass",
            severity: "critical",
            vulnerable_versions: ">=14.0.0 <14.2.25",
            url: "javascript:alert(1)",
          },
          {
            id: 3,
            title: "Duplicate",
            severity: "critical",
            vulnerable_versions: "",
          },
        ],
        minimatch: [],
        "not-installed": [
          { id: 9, title: "x", severity: "low", vulnerable_versions: "*" },
        ],
      },
      new Date("2026-11-03T10:00:00Z")
    );

    expect(report.checkedAt).toBe("2026-11-03T10:00:00.000Z");
    expect(report.counts).toEqual({ critical: 1, high: 1, moderate: 0, low: 0 });
    expect(report.packages.map((pkg) => [pkg.name, pkg.severity])).toEqual([
      ["next", "critical"],
      ["zod", "high"],
    ]);
    expect(report.packages[0].advisories).toEqual([
      {
        id: "3",
        title: "Middleware authorization bypass",
        severity: "critical",
        vulnerableVersions: ">=14.0.0 <14.2.25",
        url: null,
      },
      {
        id: "2",
        title: "Cache poisoning",
        severity: "moderate",
        vulnerableVersions: "<14.2.31",
        url: "https://github.com/advisories/GHSA-a",
      },
    ]);
  });

  it("sends the installed versions to npm's bulk advisory endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
    const report = await checkSecurityUpdates(
      { next: ["14.2.10"] },
      fetchImpl as unknown as typeof fetch,
      () => new Date("2026-11-03T10:00:00Z")
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      NPM_BULK_ADVISORY_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ next: ["14.2.10"] }),
      })
    );
    expect(report.packages).toEqual([]);
  });

  it("throws when npm is unreachable or answers an error, so nothing is cached", async () => {
    await expect(
      checkSecurityUpdates(
        { next: ["14.2.10"] },
        vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch
      )
    ).rejects.toThrow("fetch failed");
    await expect(
      checkSecurityUpdates(
        { next: ["14.2.10"] },
        vi.fn().mockResolvedValue(new Response("busy", { status: 503 })) as unknown as typeof fetch
      )
    ).rejects.toThrow("503");
  });
});

describe("security updates route", () => {
  it("is mapped to the administrator permission only", () => {
    expect(permissionsForApi("/api/admin/security-updates", "GET")).toEqual([
      "can_admin",
    ]);
  });

  it("refuses non-administrators before contacting npm", async () => {
    authorizeApiRequest.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const { GET } = await import("../../app/api/admin/security-updates/route");

    const response = await GET(
      new Request("https://stockpro.test/api/admin/security-updates")
    );

    expect(response.status).toBe(403);
    expect(authorizeApiRequest).toHaveBeenCalledWith(expect.any(Request), [
      "can_admin",
    ]);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("gives other administrators nothing once an IT contact is chosen", async () => {
    authorizeApiRequest.mockResolvedValue({ ok: true, user: { id: "admin-2" } });
    audienceMock.mockResolvedValue({ visible: false, itContactMissing: false });
    const { GET } = await import("../../app/api/admin/security-updates/route");

    const response = await GET(
      new Request("https://stockpro.test/api/admin/security-updates")
    );

    expect(await response.json()).toEqual({ ok: true, status: "not_recipient" });
    expect(audienceMock).toHaveBeenCalledWith(expect.anything(), "admin-2");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("still shows administrators the alert if the IT contacts cannot be read", async () => {
    authorizeApiRequest.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
    audienceMock.mockRejectedValue(new Error("database unavailable"));
    checkMock.mockResolvedValue({
      checkedAt: "2026-11-03T10:00:00.000Z",
      counts: { critical: 1, high: 0, moderate: 0, low: 0 },
      packages: [],
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { GET } = await import("../../app/api/admin/security-updates/route");

    const response = await GET(
      new Request("https://stockpro.test/api/admin/security-updates")
    );

    expect(await response.json()).toMatchObject({ ok: true, status: "checked" });
  });

  it("returns the report to the IT contact, flagging when none is chosen", async () => {
    authorizeApiRequest.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
    audienceMock.mockResolvedValue({ visible: true, itContactMissing: true });
    checkMock.mockResolvedValue({
      checkedAt: "2026-11-03T10:00:00.000Z",
      counts: { critical: 1, high: 0, moderate: 0, low: 0 },
      packages: [],
    });
    const { GET } = await import("../../app/api/admin/security-updates/route");

    const response = await GET(
      new Request("https://stockpro.test/api/admin/security-updates")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: "checked",
      it_contact_missing: true,
      counts: { critical: 1 },
    });
    expect(checkMock).toHaveBeenCalledWith({ next: ["14.2.10"] });
  });

  it("reports the check as unavailable instead of failing when npm is down", async () => {
    authorizeApiRequest.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
    audienceMock.mockResolvedValue({ visible: true, itContactMissing: false });
    checkMock.mockRejectedValue(new Error("npm advisory check failed (503)"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { GET } = await import("../../app/api/admin/security-updates/route");

    const response = await GET(
      new Request("https://stockpro.test/api/admin/security-updates")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "unavailable" });
  });
});
