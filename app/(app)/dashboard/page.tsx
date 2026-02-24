"use client";

import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedDeviceName, setSelectedDeviceName] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<any[]>([]);

  async function load() {
    const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
    const json = await res.json();
    if (json.ok) setData(json);
  }

  async function loadDrill(deviceId: string, deviceName: string) {
    const res = await fetch(
      `/api/dashboard/drilldown?device=${encodeURIComponent(deviceId)}`
    );
    const json = await res.json();

    if (json.ok) {
      setSelectedDeviceId(deviceId);
      setSelectedDeviceName(deviceName);
      setDrillData(json.rows);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!data) return <div className="p-6">Loading...</div>;

  const filteredDevices = data.deviceSummary
    .filter((d: any) =>
      d.device.toLowerCase().includes(search.toLowerCase())
    )
    .filter((d: any) =>
      onlyLow ? d.level !== "ok" : true
    );

  const badgeColor = (level: string) => {
    if (level === "empty") return "bg-rose-600";
    if (level === "low") return "bg-amber-500";
    return "bg-emerald-600";
  };

  return (
    <div className="space-y-8 max-w-6xl">

      {/* HEADER */}
      <div>
        <div className="text-xs text-slate-500">Dashboard</div>
        <h2 className="text-xl font-semibold">Stock Overview</h2>
      </div>

      {/* EXPORT BUTTON */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={() => window.open("/api/dashboard/export")}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
        >
          Export Full Stock Excel
        </button>

        <label className="text-sm flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={() => setOnlyLow(!onlyLow)}
            className="accent-indigo-600"
          />
          View only low / empty stock
        </label>
      </div>

      {/* SEARCH */}
      <input
        placeholder="Search device..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
      />

      {/* DEVICE TABLE */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="font-semibold mb-4">Stock by Device</div>

        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Device</th>
              <th className="text-right">IN</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.map((d: any, i: number) => (
              <tr
                key={i}
                className="cursor-pointer hover:bg-slate-800"
                onClick={() => loadDrill(d.device_id, d.device)}
              >
                <td>{d.device}</td>
                <td className="text-right">{d.total_in}</td>
                <td>
                  <span
                    className={`px-2 py-1 text-xs rounded ${badgeColor(
                      d.level
                    )}`}
                  >
                    {d.level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DRILLDOWN */}
      {selectedDeviceId && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="font-semibold">
              IMEIs IN — {selectedDeviceName}
            </div>

            <button
              onClick={() => {
                setSelectedDeviceId(null);
                setSelectedDeviceName(null);
                setDrillData([]);
              }}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">IMEI</th>
                  <th className="text-left">Box</th>
                </tr>
              </thead>
              <tbody>
                {drillData.map((r: any, i: number) => (
                  <tr key={i}>
                    <td>{r.imei}</td>
                    <td>{r.boxes?.box_code || "—"}</td>
                  </tr>
                ))}

                {drillData.length === 0 && (
                  <tr>
                    <td colSpan={2} className="text-slate-400">
                      No IMEIs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}