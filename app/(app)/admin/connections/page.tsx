"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { usePreferences } from "@/components/PreferencesProvider";

type ConnectionEvent = {
  id: string;
  email: string;
  successful: boolean;
  failure_reason: string | null;
  takeover: boolean;
  ip_address: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  device: string;
  browser: string;
  operating_system: string;
  created_at: string;
};

type Summary = {
  attempts: number;
  successful: number;
  failed: number;
  takeovers: number;
};

const EMPTY_SUMMARY: Summary = {
  attempts: 0,
  successful: 0,
  failed: 0,
  takeovers: 0,
};

export default function ConnectionsPage() {
  const { locale } = usePreferences();
  const [events, setEvents] = useState<ConnectionEvent[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [days, setDays] = useState("30");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const localeName = locale === "fr" ? "fr-BE" : locale === "nl" ? "nl-BE" : "en-GB";
  const countryNames = useMemo(
    () => new Intl.DisplayNames([localeName], { type: "region" }),
    [localeName]
  );
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      days,
      status,
    });
    if (appliedSearch) params.set("search", appliedSearch);

    const response = await apiFetch(`/api/admin/connections?${params}`, {
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(body?.error || "Unable to load connection events");
      setLoading(false);
      return;
    }

    setEvents(body.events ?? []);
    setSummary(body.summary ?? EMPTY_SUMMARY);
    setTotal(body.total ?? 0);
    setPageSize(body.page_size ?? 50);
    setLoading(false);
  }, [appliedSearch, days, page, status]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  function countryLabel(event: ConnectionEvent) {
    if (!event.country_code) return "Unavailable";
    const country = countryNames.of(event.country_code) || event.country_code;
    return event.city ? `${event.city}, ${country}` : country;
  }

  return (
    <div className="prototype-page prototype-module-page connections-page">
      <div className="prototype-page-header">
        <div>
          <h1>Connections</h1>
          <p>Review sign-in activity, devices, locations and session takeovers.</p>
        </div>
        <button type="button" className="prototype-button secondary" onClick={loadEvents}>
          Refresh
        </button>
      </div>

      <div className="connections-summary-grid">
        <article className="prototype-card connections-summary-card">
          <span>Attempts</span><strong>{summary.attempts}</strong><small>selected period</small>
        </article>
        <article className="prototype-card connections-summary-card success">
          <span>Successful</span><strong>{summary.successful}</strong><small>authenticated</small>
        </article>
        <article className="prototype-card connections-summary-card failed">
          <span>Failed</span><strong>{summary.failed}</strong><small>review repeated failures</small>
        </article>
        <article className="prototype-card connections-summary-card takeover">
          <span>Takeovers</span><strong>{summary.takeovers}</strong><small>existing sessions replaced</small>
        </article>
      </div>

      <section className="prototype-card connections-log-card">
        <div className="connections-toolbar">
          <div>
            <h2>Connection history</h2>
            <p>IP-based locations are approximate. Logs are automatically kept for 90 days.</p>
          </div>
          <form className="connections-filters" onSubmit={applySearch}>
            <label>
              <span className="sr-only">Period</span>
              <select
                aria-label="Connection period"
                value={days}
                onChange={(event) => { setDays(event.target.value); setPage(1); }}
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Result</span>
              <select
                aria-label="Connection result"
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
              >
                <option value="all">All results</option>
                <option value="successful">Successful</option>
                <option value="failed">Failed</option>
                <option value="takeover">Takeovers</option>
              </select>
            </label>
            <input
              aria-label="Search connection user"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search email…"
            />
            <button type="submit" className="prototype-button secondary">Search</button>
          </form>
        </div>

        {error && <div className="connections-error">{error}</div>}

        <div className="connections-table-wrap">
          <table className="connections-table">
            <thead>
              <tr>
                <th>Result</th>
                <th>User</th>
                <th>Date and time</th>
                <th>IP address</th>
                <th>Country / city</th>
                <th>Device</th>
                <th>Browser / OS</th>
                <th>Takeover</th>
                <th>Security signal</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="connections-empty">Loading…</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={9} className="connections-empty">No connection events found.</td></tr>
              ) : events.map((event) => {
                const signal = event.takeover
                  ? "Session takeover"
                  : event.successful
                    ? "Normal"
                    : "Review";
                return (
                  <tr key={event.id}>
                    <td>
                      <span className={`connection-badge ${event.successful ? "success" : "failed"}`}>
                        {event.successful ? "Successful" : "Failed"}
                      </span>
                    </td>
                    <td><strong>{event.email}</strong></td>
                    <td>{new Date(event.created_at).toLocaleString(localeName)}</td>
                    <td><code>{event.ip_address || "Unavailable"}</code></td>
                    <td>{countryLabel(event)}</td>
                    <td>{event.device}</td>
                    <td><span>{event.browser}</span><small>{event.operating_system}</small></td>
                    <td>{event.takeover ? "Yes" : "No"}</td>
                    <td>
                      <span className={`connection-badge signal-${signal.toLowerCase().replaceAll(" ", "-")}`}>
                        {signal}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="connections-pagination">
          <span>{total} events · Page {page} of {totalPages}</span>
          <div>
            <button
              type="button"
              className="prototype-button secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="prototype-button secondary"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
