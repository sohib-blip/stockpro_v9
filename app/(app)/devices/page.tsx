"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  device_id: string;
  device: string;
  canonical_name: string;
  units_per_imei: number;
  min_stock: number;
  imeis: number;
  boxes: number;
  items: number;
  low_stock: boolean;
};

export default function DevicesPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed");
      setRows(json.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => {
      return (
        r.device.toLowerCase().includes(qq) ||
        r.canonical_name.toLowerCase().includes(qq)
      );
    });
  }, [rows, q]);

  return (
    <div className="space-y-6">
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Inventory</div>
          <h1 className="sp-title">Devices inventory</h1>
          <p className="sp-desc">
            Search + totals par device.
          </p>
        </div>

        <button
          onClick={load}
          className="sp-btn sp-btn-ghost"
        >
          Refresh
        </button>
      </div>

      <div className="sp-card space-y-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search device…"
          className="sp-input md:w-[360px]"
        />

        {loading ? (
          <div className="sp-desc">Loading…</div>
        ) : (
          <div className="sp-card sp-card-flush">
            <div className="overflow-x-auto">
              <table className="sp-table">
                <thead>
                <tr>
                  <th>Device</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">IMEIs</th>
                  <th className="text-right">Boxes</th>
                  <th className="text-right">Units/IMEI</th>
                  <th className="text-right">Min</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.device_id}>
                    <td>
                      <div className="font-semibold text-sp-text">{r.device}</div>
                      <div className="text-xs text-sp-muted">{r.canonical_name}</div>
                    </td>
                    <td className="text-right font-semibold">
                      {r.items}
                    </td>
                    <td className="text-right">{r.imeis}</td>
                    <td className="text-right">{r.boxes}</td>
                    <td className="text-right">{r.units_per_imei}</td>
                    <td className="text-right">
                      {r.min_stock}
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="sp-desc">
                      No devices.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
