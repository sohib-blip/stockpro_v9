"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { apiFetch } from "@/lib/apiFetch";
import type {
  SecuritySeverity,
  SecurityUpdatesReport,
} from "@/lib/security-updates";

type SecurityUpdatesResponse =
  | ({
      ok: true;
      status: "checked";
      it_contact_missing?: boolean;
    } & SecurityUpdatesReport)
  | { ok: true; status: "unavailable" }
  | { ok: true; status: "not_recipient" }
  | { ok: false; error?: string };

const SEVERITY_LABELS: Record<SecuritySeverity, string> = {
  critical: "Critical",
  high: "High",
  moderate: "Moderate",
  low: "Low",
};

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tells the IT contact (an administrator chosen in User Access) when StockPro's
 * production dependencies have known security advisories, so someone without
 * GitHub access knows an update is needed. While no IT contact is chosen,
 * every administrator sees it. Other roles never call the admin-only route.
 */
export default function SecurityUpdatesBanner() {
  const { loading, hasPermission } = useAccess();
  const isAdmin = !loading && hasPermission("can_admin");
  const [result, setResult] = useState<SecurityUpdatesResponse | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setResult(null);
      return;
    }

    let cancelled = false;
    apiFetch("/api/admin/security-updates", { cache: "no-store" })
      .then((response) => response.json() as Promise<SecurityUpdatesResponse>)
      .then((json) => {
        if (!cancelled) setResult(json);
      })
      .catch(() => {
        if (!cancelled) setResult({ ok: true, status: "unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!isAdmin || !result || !result.ok || result.status === "not_recipient") {
    return null;
  }

  if (result.status === "unavailable") {
    return (
      <p className="security-updates-unavailable" role="status">
        Security update check unavailable. StockPro will try again later.
      </p>
    );
  }

  if (result.packages.length === 0) return null;

  const urgent = result.counts.critical > 0 || result.counts.high > 0;
  const checkedAt = formatCheckedAt(result.checkedAt);

  return (
    <section
      className={`security-updates-banner ${urgent ? "is-urgent" : ""}`}
      role="status"
      aria-label="Security updates needed"
    >
      <div className="security-updates-summary">
        <div className="security-updates-text">
          <strong>Security updates needed</strong>
          <ul className="security-updates-counts">
            {(Object.keys(SEVERITY_LABELS) as SecuritySeverity[])
              .filter((severity) => result.counts[severity] > 0)
              .map((severity) => (
                <li key={severity} className={`security-severity is-${severity}`}>
                  <span>{SEVERITY_LABELS[severity]}</span>
                  <b>{result.counts[severity]}</b>
                </li>
              ))}
          </ul>
          <span className="security-updates-contact">
            Contact the person who maintains StockPro so they can update the app.
          </span>
          {result.it_contact_missing && (
            <Link href="/admin" className="security-updates-it-hint">
              No IT contact chosen yet: choose one in User Access.
            </Link>
          )}
        </div>
        <button
          type="button"
          className="prototype-button secondary"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((current) => !current)}
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {showDetails && (
        <div className="security-updates-details">
          <table>
            <thead>
              <tr>
                <th>Package</th>
                <th>Installed version</th>
                <th>Severity</th>
                <th>Security advisories</th>
              </tr>
            </thead>
            <tbody>
              {result.packages.map((pkg) => (
                <tr key={pkg.name}>
                  <td className="security-package-name">{pkg.name}</td>
                  <td>{pkg.installedVersions.join(", ")}</td>
                  <td>
                    <span className={`security-severity is-${pkg.severity}`}>
                      <span>{SEVERITY_LABELS[pkg.severity]}</span>
                    </span>
                  </td>
                  <td>
                    <ul className="security-advisory-list">
                      {pkg.advisories.map((advisory) => (
                        <li key={advisory.id}>
                          <span className={`security-severity is-${advisory.severity}`}>
                            <span>{SEVERITY_LABELS[advisory.severity]}</span>
                          </span>{" "}
                          {advisory.url ? (
                            <a href={advisory.url} target="_blank" rel="noreferrer noopener">
                              {advisory.title || advisory.id}
                            </a>
                          ) : (
                            advisory.title || advisory.id
                          )}{" "}
                          <code>{advisory.vulnerableVersions}</code>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {checkedAt && (
            <p className="security-updates-checked">
              <span>Last checked:</span> {checkedAt}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
