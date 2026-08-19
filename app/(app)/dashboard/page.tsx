"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";
import { useAccess } from "@/components/AccessProvider";
import ProcessFeedback, { type ProcessFeedbackValue } from "@/components/ProcessFeedback";
import { buildDashboardStockAlerts } from "@/lib/dashboard-inventory-rows";

type KPI = {
  total_bins: number;
  total_boxes: number;
  total_imei: number;
  alerts: number;
};

type ImeiSearchRow = {
  imei: string;
  found: boolean;
  device: string | null;
  box_id: string | null;
  location: string | null;
  status: string | null;
};

const ACCESSORY_CATEGORIES = [
  "All",
  "Packages",
  "Vision",
  "Harness",
  "Consumables",
  "Items",
] as const;

type AccessoryCategoryFilter = (typeof ACCESSORY_CATEGORIES)[number];

const CHART_PAGE_SIZE = 10;
const ACCESSORY_PREVIEW_SIZE = 7;

function stockLevel(row: any) {
  const stock = Number(row.imei_count || 0);
  const minimum = Number(row.min_stock || 0);
  if (stock <= 0) return "critical";
  if (minimum > 0 && stock <= minimum) return "low";
  return "ok";
}

function remainingPercent(row: any) {
  const stock = Number(row.imei_count || 0);
  const minimum = Number(row.min_stock || 0);
  if (stock <= 0) return 0;
  if (minimum <= 0) return 100;
  return Math.min(100, Math.round((stock / (minimum * 5)) * 100));
}

function activityPresentation(row: any) {
  if (row.type === "IN") {
    return {
      label: "Inbound",
      detail: `${row.qty || 0} IMEIs${row.box_code ? ` · ${row.box_code}` : ""}${
        row.device ? ` · ${row.device}` : ""
      }`,
      tone: "success",
    };
  }

  if (row.type === "OUT") {
    return {
      label: "Outbound",
      detail: `${row.qty || 0} IMEIs${row.device ? ` · ${row.device}` : ""}`,
      tone: "danger",
    };
  }

  if (row.type === "TRANSFER") {
    return {
      label: "Transfer",
      detail: `${row.box_code || "Box"}${
        row.from_floor || row.to_floor
          ? ` · ${row.from_floor || "—"} → ${row.to_floor || "—"}`
          : ""
      }`,
      tone: "brand",
    };
  }

  return {
    label: "Return",
    detail: `${row.qty || 0} IMEIs${row.device ? ` · ${row.device}` : ""}`,
    tone: "warning",
  };
}

export default function DashboardPage() {
  const { hasPermission } = useAccess();
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [bins, setBins] = useState<any[]>([]);
  const [accessories, setAccessories] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [drilldown, setDrilldown] = useState<any[]>([]);
  const [flow, setFlow] = useState<any[]>([]);
  const [openDevice, setOpenDevice] = useState<string | null>(null);
  const [topDevices, setTopDevices] = useState<any[]>([]);
  const [editingMinStock, setEditingMinStock] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [boxSearch, setBoxSearch] = useState("");
  const [accessorySearch, setAccessorySearch] = useState("");
  const [accessoryCategory, setAccessoryCategory] =
    useState<AccessoryCategoryFilter>("All");
  const [chartPage, setChartPage] = useState(0);
  const [showAllAccessories, setShowAllAccessories] = useState(false);
  const [showStockAlerts, setShowStockAlerts] = useState(false);
  const [showShippedRanking, setShowShippedRanking] = useState(false);
  const [showImeiSearch, setShowImeiSearch] = useState(false);
  const [imeiSearchText, setImeiSearchText] = useState("");
  const [imeiSearchRows, setImeiSearchRows] = useState<ImeiSearchRow[]>([]);
  const [imeiSearchBusy, setImeiSearchBusy] = useState(false);
  const [imeiSearchError, setImeiSearchError] = useState("");
  const [feedback, setFeedback] = useState<ProcessFeedbackValue | null>(null);

  const filteredBins = useMemo(
    () =>
      bins.filter((row: any) =>
        row.device?.toLowerCase().includes(search.toLowerCase())
      ),
    [bins, search]
  );

  const filteredAccessories = useMemo(
    () =>
      accessories.filter((row: any) => {
        const matchesCategory =
          accessoryCategory === "All" || row.category === accessoryCategory;
        const query = accessorySearch.toLowerCase();
        const matchesSearch =
          row.name?.toLowerCase().includes(query) ||
          row.bin?.toLowerCase().includes(query);
        return matchesCategory && matchesSearch;
      }),
    [accessories, accessoryCategory, accessorySearch]
  );

  const allChartData = useMemo(
    () =>
      bins
        .map((row: any) => {
          const movement = flow.find((item: any) => item.device === row.device);
          return {
            device: row.device,
            inbound: Number(movement?.total_in || 0),
            outbound: Number(movement?.total_out || 0),
          };
        })
        .sort(
          (a, b) =>
            b.inbound + b.outbound - (a.inbound + a.outbound)
        ),
    [bins, flow]
  );

  const chartPageCount = Math.max(
    1,
    Math.ceil(allChartData.length / CHART_PAGE_SIZE)
  );
  const activeChartPage = Math.min(chartPage, chartPageCount - 1);
  const chartStart = activeChartPage * CHART_PAGE_SIZE;
  const chartData = allChartData.slice(
    chartStart,
    chartStart + CHART_PAGE_SIZE
  );
  const visibleInbound = chartData.reduce(
    (total, row) => total + row.inbound,
    0
  );
  const visibleOutbound = chartData.reduce(
    (total, row) => total + row.outbound,
    0
  );

  const totalShipped = topDevices.reduce(
    (total, row) => total + Number(row.total_out || 0),
    0
  );
  const stockAlerts = useMemo(
    () => buildDashboardStockAlerts(bins, accessories),
    [accessories, bins]
  );
  const lowAlerts = stockAlerts.filter((row) => row.status === "LOW").length;
  const emptyAlerts = stockAlerts.filter((row) => row.status === "EMPTY").length;
  const alertCount = lowAlerts + emptyAlerts;
  const visibleBins = filteredBins;
  const visibleAccessories = showAllAccessories
    ? filteredAccessories
    : filteredAccessories.slice(0, ACCESSORY_PREVIEW_SIZE);
  const deviceName =
    bins.find((row: any) => row.device_id === openDevice)?.device || openDevice;

  async function loadAll() {
    const [kpiRes, binsRes, activityRes, flowRes, salesRes, accessoriesRes] =
      await Promise.all([
        apiFetch("/api/dashboard/summary", { cache: "no-store" }),
        apiFetch("/api/dashboard/bins", { cache: "no-store" }),
        apiFetch("/api/dashboard/activity", { cache: "no-store" }),
        apiFetch("/api/dashboard/device-flow", { cache: "no-store" }),
        apiFetch("/api/dashboard/sales", { cache: "no-store" }),
        apiFetch("/api/dashboard/accessories", { cache: "no-store" }),
      ]);

    const [kpiJson, binsJson, activityJson, flowJson, salesJson, accessoriesJson] =
      await Promise.all([
        kpiRes.json(),
        binsRes.json(),
        activityRes.json(),
        flowRes.json(),
        salesRes.json(),
        accessoriesRes.json(),
      ]);

    if (kpiJson.ok) setKpi(kpiJson.kpis);
    if (binsJson.ok) setBins(binsJson.rows || []);
    if (activityJson.ok) setActivity(activityJson.rows || []);
    if (flowJson.ok) setFlow(flowJson.rows || []);
    if (salesJson.ok) setTopDevices(salesJson.rows || []);
    if (accessoriesJson.ok) setAccessories(accessoriesJson.rows || []);
  }

  async function openDrilldown(deviceId: string) {
    setOpenDevice(deviceId);
    const response = await apiFetch(
      `/api/dashboard/drilldown?device_id=${deviceId}`
    );
    const json = await response.json();
    if (json.ok) setDrilldown(json.rows || []);
  }

  async function saveMinimumStock(deviceId: string, value: number) {
    setFeedback(null);
    const response = await apiFetch("/api/bins/update-min-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, min_stock: value }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setFeedback({
        kind: "error",
        title: "Minimum stock update failed",
        message: json?.error || "The minimum stock value could not be saved.",
      });
      return;
    }
    setEditingMinStock(null);
    setFeedback({
      kind: "success",
      title: "Minimum stock updated",
      message: `The new minimum stock is ${value}. Dashboard alerts are up to date.`,
    });
  }

  async function downloadDashboardFile(url: string, filename: string, label: string) {
    setFeedback(null);
    try {
      await downloadApiFile(url, filename);
      setFeedback({
        kind: "info",
        title: "Export ready",
        message: `${label} download started.`,
      });
    } catch (error: any) {
      setFeedback({
        kind: "error",
        title: "Export failed",
        message: error?.message || `${label} could not be downloaded.`,
      });
    }
  }

  async function searchImeis() {
    setImeiSearchBusy(true);
    setImeiSearchError("");

    try {
      const response = await apiFetch("/api/dashboard/imei-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imeisText: imeiSearchText }),
      });
      const json = await response.json();

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "IMEI search failed");
      }

      setImeiSearchRows(json.rows || []);
    } catch (error: any) {
      setImeiSearchRows([]);
      setImeiSearchError(error?.message || "IMEI search failed");
    } finally {
      setImeiSearchBusy(false);
    }
  }

  function clearImeiSearch() {
    setImeiSearchText("");
    setImeiSearchRows([]);
    setImeiSearchError("");
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!showShippedRanking && !showImeiSearch) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowShippedRanking(false);
        setShowImeiSearch(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [showImeiSearch, showShippedRanking]);

  return (
    <div className="prototype-page prototype-dashboard">
      <header className="prototype-page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Stock position, alerts and recent activity across the warehouse.</p>
        </div>
        <div className="prototype-page-actions">
          <button
            type="button"
            className="prototype-button secondary dashboard-imei-trigger"
            aria-haspopup="dialog"
            onClick={() => setShowImeiSearch(true)}
          >
            <span aria-hidden="true">⌕</span> IMEI Search
          </button>
          {hasPermission("can_inventory_export") && (
            <>
              <button
                type="button"
                className="prototype-button secondary"
                onClick={() =>
                  void downloadDashboardFile("/api/dashboard/export", "stock.xlsx", "Stock export")
                }
              >
                Export Stock
              </button>
              <button
                type="button"
                className="prototype-button secondary"
                onClick={() =>
                  void downloadDashboardFile(
                    "/api/dashboard/export-count-sheet",
                    "count-sheet.xlsx",
                    "Count sheet"
                  )
                }
              >
                Export Count Sheet
              </button>
            </>
          )}
          <button
            type="button"
            className="prototype-button secondary"
            onClick={() =>
              void downloadDashboardFile(
                "/api/accessory-bins/export",
                "accessories.xlsx",
                "Accessory export"
              )
            }
          >
            Export Accessories
          </button>
        </div>
      </header>

      {feedback && (
        <ProcessFeedback
          {...feedback}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {showImeiSearch && (
        <div
          className="dashboard-ranking-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowImeiSearch(false);
            }
          }}
        >
          <section
            className="dashboard-imei-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="imei-search-title"
          >
            <header className="dashboard-ranking-header">
              <div>
                <span>Inventory lookup</span>
                <h2 id="imei-search-title">IMEI Search</h2>
                <p>Search one IMEI or paste up to 200 IMEIs.</p>
              </div>
              <button
                type="button"
                className="dashboard-ranking-close"
                aria-label="Close"
                onClick={() => setShowImeiSearch(false)}
              >
                ×
              </button>
            </header>

            <div className="dashboard-imei-form">
              <label htmlFor="dashboard-imei-input">IMEIs</label>
              <textarea
                id="dashboard-imei-input"
                aria-label="IMEIs to search"
                value={imeiSearchText}
                onChange={(event) => setImeiSearchText(event.target.value)}
                placeholder="Paste IMEIs here, separated by spaces, commas or new lines."
                autoFocus
              />
              <div className="dashboard-imei-form-actions">
                <button
                  type="button"
                  className="prototype-button secondary"
                  onClick={clearImeiSearch}
                  disabled={imeiSearchBusy}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="prototype-button primary"
                  onClick={searchImeis}
                  disabled={imeiSearchBusy}
                >
                  {imeiSearchBusy ? "Searching…" : "Search"}
                </button>
              </div>
              {imeiSearchError && (
                <div className="dashboard-imei-error" role="alert">
                  {imeiSearchError}
                </div>
              )}
            </div>

            {imeiSearchRows.length > 0 && (
              <div className="dashboard-imei-summary" aria-label="Search results">
                <span>
                  Found <strong>{imeiSearchRows.filter((row) => row.found).length}</strong>
                </span>
                <span>
                  Not found <strong>{imeiSearchRows.filter((row) => !row.found).length}</strong>
                </span>
              </div>
            )}

            <div className="dashboard-imei-results">
              {imeiSearchRows.length > 0 ? (
                <table className="prototype-table dashboard-imei-table">
                  <thead>
                    <tr>
                      <th>IMEI</th>
                      <th>Device</th>
                      <th>Box ID</th>
                      <th>Location</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {imeiSearchRows.map((row) => (
                      <tr key={row.imei} className={!row.found ? "is-missing" : ""}>
                        <td className="dashboard-imei-value">{row.imei}</td>
                        <td>{row.device || "—"}</td>
                        <td>{row.box_id || "—"}</td>
                        <td>{row.location || "—"}</td>
                        <td>
                          <span
                            className={`dashboard-imei-status ${
                              row.found ? String(row.status || "").toLowerCase() : "missing"
                            }`}
                          >
                            {row.found ? row.status || "Unknown" : "Not found"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="prototype-empty dashboard-imei-empty">
                  Enter one or more IMEIs to locate devices in the warehouse.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="prototype-kpi-grid" aria-label="Inventory summary">
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">Total bins</div>
          <div className="prototype-kpi-value">{kpi?.total_bins ?? "—"}</div>
          <div className="prototype-kpi-caption">device models configured</div>
        </article>
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">Total boxes</div>
          <div className="prototype-kpi-value">{kpi?.total_boxes ?? "—"}</div>
          <div className="prototype-kpi-caption">active warehouse boxes</div>
        </article>
        <article className="prototype-kpi-card">
          <div className="prototype-eyebrow">Total IMEIs</div>
          <div className="prototype-kpi-value">
            {kpi?.total_imei?.toLocaleString("en-GB") ?? "—"}
          </div>
          <div className="prototype-kpi-caption">devices in stock</div>
        </article>
        <article className="prototype-kpi-card is-alert">
          <div className="prototype-eyebrow">⚠ Stock alerts</div>
          <div className="prototype-kpi-value">{kpi?.alerts ?? alertCount}</div>
          <div className="prototype-kpi-caption">
            {`${lowAlerts} low · ${emptyAlerts} empty — see tables below`}
          </div>
        </article>
      </section>

      <section
        id="dashboard-stock-attention"
        className={`prototype-card prototype-table-card dashboard-alerts-card${
          stockAlerts.length ? " has-alerts" : ""
        }`}
        aria-live="polite"
      >
        <button
          type="button"
          className="dashboard-alerts-toggle"
          aria-expanded={showStockAlerts}
          aria-controls="dashboard-stock-alert-details"
          onClick={() => setShowStockAlerts((current) => !current)}
        >
          <div>
            <span className="dashboard-alerts-eyebrow">Low &amp; empty inventory</span>
            <h2>Stock attention needed</h2>
          </div>
          <div className="dashboard-alerts-toggle-summary">
            <div className="dashboard-alerts-counts" aria-label="Stock alert totals">
              <span className="is-low"><strong>{lowAlerts}</strong> Low</span>
              <span className="is-empty"><strong>{emptyAlerts}</strong> Empty</span>
            </div>
            <span className={`dashboard-alerts-chevron${showStockAlerts ? " is-open" : ""}`} aria-hidden="true">⌄</span>
          </div>
        </button>
        {showStockAlerts && stockAlerts.length ? (
          <div id="dashboard-stock-alert-details" className="dashboard-alerts-scroll">
            <table className="prototype-table dashboard-alerts-table">
              <thead>
                <tr>
                  <th>Inventory Type</th>
                  <th>Item</th>
                  <th>Available</th>
                  <th>Minimum</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stockAlerts.map((row) => {
                  const level = row.status === "EMPTY" ? "critical" : "low";
                  return (
                    <tr key={row.id} className={`stock-row ${level}`}>
                      <td><span className="dashboard-alert-type">{row.inventory_type}</span></td>
                      <td><strong>{row.name}</strong></td>
                      <td>{row.current_stock.toLocaleString("en-GB")}</td>
                      <td>{row.minimum_stock.toLocaleString("en-GB")}</td>
                      <td>
                        <span className={`status-badge ${level}`}>
                          {row.status === "LOW" ? "▼ LOW" : "✕ EMPTY"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : showStockAlerts ? (
          <div id="dashboard-stock-alert-details" className="dashboard-alerts-clear">
            <span aria-hidden="true">✓</span>
            <div><strong>All stock levels are healthy</strong><small>No active device, accessory or packaging alerts.</small></div>
          </div>
        ) : null}
      </section>

      <section className="dashboard-insights-grid">
        <article className="prototype-card dashboard-chart-card">
          <div className="prototype-card-heading">
            <h2>Device inbound vs outbound</h2>
            <div className="chart-legend" aria-label="Chart legend">
              <span>
                <i className="inbound" />
                Inbound <strong>{visibleInbound.toLocaleString("en-GB")}</strong>
              </span>
              <span>
                <i className="outbound" />
                Outbound <strong>{visibleOutbound.toLocaleString("en-GB")}</strong>
              </span>
            </div>
          </div>
          <div className="dashboard-chart-viewport">
            <div className="dashboard-chart">
              {chartData.length > 0 ? (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  initialDimension={{ width: 1, height: 170 }}
                >
                  <BarChart
                    data={chartData}
                    barCategoryGap="18%"
                    margin={{ top: 24, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={42}
                      allowDecimals={false}
                      tick={{ fill: "var(--muted)", fontSize: 10.5 }}
                      tickFormatter={(value: number) =>
                        value >= 1000
                          ? `${Math.round(value / 100) / 10}k`
                          : String(value)
                      }
                    />
                    <XAxis
                      dataKey="device"
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      height={34}
                      tickFormatter={(value: string) =>
                        value.length > 11
                          ? `${value.slice(0, 6)}…${value.slice(-4)}`
                          : value
                      }
                      tick={{ fill: "var(--muted)", fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--surface-subtle)" }}
                      contentStyle={{
                        background: "var(--surface-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [
                        Number(value ?? 0).toLocaleString("en-GB"),
                        String(name),
                      ]}
                    />
                    <Bar
                      dataKey="inbound"
                      name="Inbound"
                      fill="var(--brand)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={48}
                    >
                      <LabelList
                        dataKey="inbound"
                        position="top"
                        fill="var(--muted-strong)"
                        fontSize={10}
                        formatter={(value) => {
                          const numericValue = Number(value ?? 0);
                          return numericValue > 0
                            ? numericValue.toLocaleString("en-GB")
                            : "";
                        }}
                      />
                    </Bar>
                    <Bar
                      dataKey="outbound"
                      name="Outbound"
                      fill="var(--chart-secondary)"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={48}
                    >
                      <LabelList
                        dataKey="outbound"
                        position="top"
                        fill="var(--muted-strong)"
                        fontSize={10}
                        formatter={(value) => {
                          const numericValue = Number(value ?? 0);
                          return numericValue > 0
                            ? numericValue.toLocaleString("en-GB")
                            : "";
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="prototype-empty">No device movement yet</div>
              )}
            </div>
          </div>
          {allChartData.length > CHART_PAGE_SIZE && (
            <div className="dashboard-chart-pagination">
              <span>
                {chartStart + 1}–{Math.min(chartStart + CHART_PAGE_SIZE, allChartData.length)} of {allChartData.length} devices
              </span>
              <div>
                <button
                  type="button"
                  aria-label="Previous devices in chart"
                  disabled={activeChartPage === 0}
                  onClick={() => setChartPage((current) => Math.max(0, current - 1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next devices in chart"
                  disabled={activeChartPage >= chartPageCount - 1}
                  onClick={() =>
                    setChartPage((current) => Math.min(chartPageCount - 1, current + 1))
                  }
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </article>

        <div className="dashboard-side-stack">
        <article
          className="prototype-card top-devices-card is-interactive"
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-label="View all shipped devices"
          onClick={() => setShowShippedRanking(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setShowShippedRanking(true);
            }
          }}
        >
          <div className="prototype-card-heading">
            <h2>Most shipped devices</h2>
            <span className="top-devices-card-hint">
              View all <span aria-hidden="true">↗</span>
            </span>
          </div>
          <div className="top-device-list">
            {topDevices.slice(0, 3).map((row) => {
              const percent = totalShipped
                ? Math.round((Number(row.total_out || 0) / totalShipped) * 100)
                : 0;
              return (
                <div key={row.device} className="top-device-row">
                  <div>
                    <strong title={row.device}>{row.device}</strong>
                    <span>{percent}%</span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
            {topDevices.length === 0 && (
              <div className="prototype-empty compact">No outbound data yet</div>
            )}
          </div>
        </article>
        <article className="prototype-card recent-activity-card">
          <div className="prototype-card-heading">
            <h2>Recent activity</h2>
          </div>
          <div className="recent-activity-list">
            {activity.slice(0, 5).map((row, index) => {
              const presentation = activityPresentation(row);
              return (
                <div key={`${row.created_at}-${index}`} className="activity-row">
                  <span className={`activity-dot ${presentation.tone}`} />
                  <div>
                    <div>
                      <strong>{presentation.label}</strong> — {presentation.detail}
                    </div>
                    <time dateTime={row.created_at}>
                      {new Date(row.created_at).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </div>
              );
            })}
            {activity.length === 0 && (
              <div className="prototype-empty compact">No recent activity</div>
            )}
          </div>
        </article>
        </div>
      </section>

      {showShippedRanking && (
        <div
          className="dashboard-ranking-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowShippedRanking(false);
            }
          }}
        >
          <section
            className="dashboard-ranking-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shipped-ranking-title"
          >
            <header className="dashboard-ranking-header">
              <div>
                <span>Outbound performance</span>
                <h2 id="shipped-ranking-title">
                  Complete shipped device ranking
                </h2>
                <p>All devices ranked by outbound volume.</p>
              </div>
              <button
                type="button"
                className="dashboard-ranking-close"
                aria-label="Close"
                autoFocus
                onClick={() => setShowShippedRanking(false)}
              >
                ×
              </button>
            </header>

            <div className="dashboard-ranking-summary">
              <div>
                <span>Devices</span>
                <strong>{topDevices.length.toLocaleString("en-GB")}</strong>
              </div>
              <div>
                <span>Total outbound</span>
                <strong>{totalShipped.toLocaleString("en-GB")}</strong>
              </div>
            </div>

            <div className="dashboard-ranking-list">
              {topDevices.map((row, index) => {
                const quantity = Number(row.total_out || 0);
                const percent = totalShipped
                  ? Math.round((quantity / totalShipped) * 100)
                  : 0;
                return (
                  <div
                    key={row.device}
                    className="dashboard-ranking-row"
                  >
                    <span className="dashboard-ranking-position">
                      {index + 1}
                    </span>
                    <div className="dashboard-ranking-device">
                      <strong>{row.device}</strong>
                      <div className="progress-track">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                    <div className="dashboard-ranking-value">
                      <strong>{quantity.toLocaleString("en-GB")}</strong>
                      <span>{percent}%</span>
                    </div>
                  </div>
                );
              })}
              {topDevices.length === 0 && (
                <div className="prototype-empty">
                  No outbound data yet
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <article className="prototype-card prototype-table-card device-inventory-card">
          <div className="prototype-table-toolbar">
            <h2>Device inventory</h2>
            <input
              type="search"
              placeholder="Search device…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="prototype-table-scroll">
            <table className="prototype-table device-table">
              <thead>
                <tr>
                  <th>Device bin</th>
                  <th>Boxes</th>
                  <th>IMEIs</th>
                  <th>Min stock</th>
                  <th>Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleBins.map((row) => {
                  const level = stockLevel(row);
                  const percent = remainingPercent(row);
                  return (
                    <tr
                      key={row.device_id}
                      className={`stock-row ${level}`}
                      onClick={() => openDrilldown(row.device_id)}
                    >
                      <td><strong>{row.device}</strong></td>
                      <td>{Number(row.boxes_count || 0).toLocaleString("en-GB")}</td>
                      <td>{Number(row.imei_count || 0).toLocaleString("en-GB")}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {editingMinStock === row.device_id ? (
                          <input
                            className="minimum-stock-input"
                            type="number"
                            value={row.min_stock ?? 0}
                            autoFocus
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setBins((current) =>
                                current.map((item) =>
                                  item.device_id === row.device_id
                                    ? { ...item, min_stock: value }
                                    : item
                                )
                              );
                            }}
                            onBlur={(event) =>
                              saveMinimumStock(row.device_id, Number(event.target.value))
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="minimum-stock-button"
                            onClick={() => setEditingMinStock(row.device_id)}
                          >
                            {row.min_stock ?? 0} <span aria-hidden="true">✎</span>
                          </button>
                        )}
                      </td>
                      <td className={`remaining-value ${level}`}>{percent}%</td>
                      <td>
                        <span className={`status-badge ${level}`}>
                          {level === "ok" && "OK"}
                          {level === "low" && "▼ LOW"}
                          {level === "critical" && "✕ EMPTY"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="prototype-table-footer">
            {filteredBins.length} device bins · all devices shown · click a row for box and floor detail
          </div>
      </article>

      {openDevice && (
        <section className="prototype-card prototype-table-card drilldown-card">
          <div className="prototype-table-toolbar">
            <div>
              <h2>Device {deviceName}</h2>
              <p>Box and floor detail</p>
            </div>
            <div className="prototype-page-actions">
              <input
                type="search"
                placeholder="Filter by box code"
                value={boxSearch}
                onChange={(event) => setBoxSearch(event.target.value)}
              />
              <button
                type="button"
                className="prototype-button secondary"
                onClick={() => setOpenDevice(null)}
              >
                Close
              </button>
            </div>
          </div>
          <div className="prototype-table-scroll">
            <table className="prototype-table">
              <thead>
                <tr>
                  <th>Box</th>
                  <th>Floor</th>
                  <th>Remaining</th>
                  <th>Total received</th>
                  <th>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {drilldown
                  .filter((row: any) => Number(row.remaining) > 0)
                  .filter((row: any) =>
                    row.box_code?.toLowerCase().includes(boxSearch.toLowerCase())
                  )
                  .map((row) => (
                    <tr key={row.box_id}>
                      <td><strong>{row.box_code}</strong></td>
                      <td>{row.floor}</td>
                      <td>{row.remaining}</td>
                      <td>{row.total_ever}</td>
                      <td>{row.percent}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="prototype-card prototype-table-card accessory-inventory-card">
        <div className="prototype-table-toolbar accessory-toolbar">
          <h2>Accessory inventory</h2>
          <div className="accessory-toolbar-controls">
            <div className="category-filter" aria-label="Accessory category">
              {ACCESSORY_CATEGORIES.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={accessoryCategory === category ? "is-active" : ""}
                  onClick={() => {
                    setAccessoryCategory(category);
                    setShowAllAccessories(false);
                  }}
                >
                  {category}
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder="Search accessory…"
              value={accessorySearch}
              onChange={(event) => {
                setAccessorySearch(event.target.value);
                setShowAllAccessories(false);
              }}
            />
          </div>
        </div>
        <div className="prototype-table-scroll">
          <table className="prototype-table accessory-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Minimum</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleAccessories.map((row) => {
                const level =
                  row.status === "EMPTY"
                    ? "critical"
                    : row.status === "LOW"
                      ? "low"
                      : "ok";
                return (
                  <tr key={row.id} className={`stock-row ${level}`}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.details ? <small className="accessory-item-detail">{row.details}</small> : null}
                    </td>
                    <td>{row.category}</td>
                    <td>{Number(row.current_stock || 0).toLocaleString("en-GB")}</td>
                    <td>{Number(row.minimum_stock || 0).toLocaleString("en-GB")}</td>
                    <td>
                      <span className={`status-badge ${level}`}>
                        {level === "ok" && "OK"}
                        {level === "low" && "▼ LOW"}
                        {level === "critical" && "✕ EMPTY"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="prototype-table-footer dashboard-accessory-footer">
          <span>
            Showing {visibleAccessories.length} of {filteredAccessories.length} inventory items
          </span>
          {filteredAccessories.length > ACCESSORY_PREVIEW_SIZE && (
            <button
              type="button"
              className="dashboard-view-all-button"
              onClick={() => setShowAllAccessories((current) => !current)}
            >
              {showAllAccessories ? "Show less" : `View all (${filteredAccessories.length})`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
