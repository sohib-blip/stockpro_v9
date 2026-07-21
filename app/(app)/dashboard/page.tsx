"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";

type KPI = {
  total_bins: number;
  total_boxes: number;
  total_imei: number;
  alerts: number;
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

  const totalShipped = topDevices.reduce(
    (total, row) => total + Number(row.total_out || 0),
    0
  );
  const lowAlerts = bins.filter((row) => stockLevel(row) === "low").length;
  const emptyAlerts = bins.filter((row) => stockLevel(row) === "critical").length;
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
    await apiFetch("/api/bins/update-min-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, min_stock: value }),
    });
    setEditingMinStock(null);
  }

  useEffect(() => {
    loadAll();
  }, []);

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
            className="prototype-button secondary"
            onClick={() =>
              downloadApiFile("/api/dashboard/export", "stock.xlsx").catch(
                (error) => window.alert(error.message)
              )
            }
          >
            Export Stock
          </button>
          <button
            type="button"
            className="prototype-button secondary"
            onClick={() =>
              downloadApiFile(
                "/api/dashboard/export-count-sheet",
                "count-sheet.xlsx"
              ).catch((error) => window.alert(error.message))
            }
          >
            Export Count Sheet
          </button>
          <button
            type="button"
            className="prototype-button secondary"
            onClick={() =>
              downloadApiFile(
                "/api/accessory-bins/export",
                "accessories.xlsx"
              ).catch((error) => window.alert(error.message))
            }
          >
            Export Accessories
          </button>
        </div>
      </header>

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

      <section className="dashboard-insights-grid">
        <article className="prototype-card dashboard-chart-card">
          <div className="prototype-card-heading">
            <h2>Device inbound vs outbound</h2>
            <div className="chart-legend" aria-label="Chart legend">
              <span><i className="inbound" />Inbound</span>
              <span><i className="outbound" />Outbound</span>
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
                <BarChart data={chartData} barCategoryGap="20%">
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
                  />
                  <Bar
                    dataKey="inbound"
                    name="Inbound"
                    fill="var(--brand)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="outbound"
                    name="Outbound"
                    fill="var(--chart-secondary)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={48}
                  />
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
        <article className="prototype-card top-devices-card">
          <div className="prototype-card-heading">
            <h2>Most shipped devices</h2>
          </div>
          <div className="top-device-list">
            {topDevices.slice(0, 5).map((row) => {
              const percent = totalShipped
                ? Math.round((Number(row.total_out || 0) / totalShipped) * 100)
                : 0;
              return (
                <div key={row.device} className="top-device-row">
                  <div>
                    <strong>{row.device}</strong>
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
                <th>Accessory</th>
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
                    <td><strong>{row.name}</strong></td>
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
            Showing {visibleAccessories.length} of {filteredAccessories.length} accessories
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
