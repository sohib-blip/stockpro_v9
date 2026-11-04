import { z } from "zod";

// npm's public bulk advisory endpoint, the one `npm audit` uses. It needs no
// token and only returns advisories that affect the versions sent to it.
export const NPM_BULK_ADVISORY_URL =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

export const SECURITY_SEVERITIES = ["critical", "high", "moderate", "low"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

export type SecurityAdvisory = {
  id: string;
  title: string;
  severity: SecuritySeverity;
  vulnerableVersions: string;
  url: string | null;
};

export type VulnerablePackage = {
  name: string;
  installedVersions: string[];
  severity: SecuritySeverity;
  advisories: SecurityAdvisory[];
};

export type SecurityUpdatesReport = {
  checkedAt: string;
  counts: Record<SecuritySeverity, number>;
  packages: VulnerablePackage[];
};

type LockfilePackage = {
  name?: string;
  version?: string;
  dev?: boolean;
  link?: boolean;
};

type Lockfile = { packages?: Record<string, LockfilePackage> };

/**
 * Lists the installed versions of every package that ships to production,
 * like `npm audit --omit=dev`. Development-only tools are left out.
 */
export function productionPackageVersions(lockfile: Lockfile) {
  const versions = new Map<string, Set<string>>();

  for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
    if (!path || entry.dev || entry.link || !entry.version) continue;
    const name = entry.name || path.split("node_modules/").pop();
    if (!name) continue;
    if (!versions.has(name)) versions.set(name, new Set());
    versions.get(name)!.add(entry.version);
  }

  return Object.fromEntries(
    Array.from(versions.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, set]) => [name, Array.from(set).sort()])
  ) as Record<string, string[]>;
}

const advisorySchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().default(""),
  severity: z.string(),
  vulnerable_versions: z.string().default(""),
  url: z.string().optional().nullable(),
});

const bulkResponseSchema = z.record(z.string(), z.array(advisorySchema));

function normalizeSeverity(value: string): SecuritySeverity {
  const lower = value.toLowerCase();
  return (SECURITY_SEVERITIES as readonly string[]).includes(lower)
    ? (lower as SecuritySeverity)
    : "low";
}

function severityRank(severity: SecuritySeverity) {
  return SECURITY_SEVERITIES.indexOf(severity);
}

function safeAdvisoryUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Turns npm's bulk response into a per-package summary, worst first. */
export function summarizeAdvisories(
  installed: Record<string, string[]>,
  response: unknown,
  checkedAt: Date
): SecurityUpdatesReport {
  const parsed = bulkResponseSchema.parse(response);
  const counts: Record<SecuritySeverity, number> = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
  };

  const packages = Object.entries(parsed)
    .filter(([name, advisories]) => installed[name] && advisories.length > 0)
    .map(([name, advisories]): VulnerablePackage => {
      const unique = new Map<string, SecurityAdvisory>();
      for (const advisory of advisories) {
        const id = String(advisory.id);
        if (unique.has(id)) continue;
        unique.set(id, {
          id,
          title: advisory.title.trim().slice(0, 300),
          severity: normalizeSeverity(advisory.severity),
          vulnerableVersions: advisory.vulnerable_versions.slice(0, 120),
          url: safeAdvisoryUrl(advisory.url),
        });
      }
      const sorted = Array.from(unique.values()).sort(
        (a, b) => severityRank(a.severity) - severityRank(b.severity)
      );
      return {
        name,
        installedVersions: installed[name],
        severity: sorted[0].severity,
        advisories: sorted,
      };
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.name.localeCompare(b.name)
    );

  for (const pkg of packages) counts[pkg.severity] += 1;

  return { checkedAt: checkedAt.toISOString(), counts, packages };
}

/**
 * Asks npm which installed versions have known advisories. Throws when npm is
 * unreachable or answers something unexpected, so a failure is never cached.
 */
export async function checkSecurityUpdates(
  installed: Record<string, string[]>,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<SecurityUpdatesReport> {
  const response = await fetchImpl(NPM_BULK_ADVISORY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(installed),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`npm advisory check failed (${response.status})`);
  }

  return summarizeAdvisories(installed, await response.json(), now());
}
