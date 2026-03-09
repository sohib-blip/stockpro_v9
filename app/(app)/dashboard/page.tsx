"use client";

import { useEffect, useState } from "react";
import {
 BarChart,
 Bar,
 XAxis,
 YAxis,
 Tooltip,
 ResponsiveContainer
} from "recharts";

type KPI = {
  total_bins: number;
  total_boxes: number;
  total_imei: number;
  alerts: number;
};

export default function DashboardPage() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [bins, setBins] = useState<any[]>([]);

  const chartData = bins?.map((b:any)=>({
 device: b.device,
 stock: Number(b.imei_count || 0)
})) || [];

  const [floors, setFloors] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [drilldown, setDrilldown] = useState<any[]>([]);
  const [openDevice, setOpenDevice] = useState<string | null>(null);

  async function loadAll() {
    const [kpiRes, binsRes, floorsRes, activityRes] = await Promise.all([
      fetch("/api/dashboard/summary"),
      fetch("/api/dashboard/bins"),
      fetch("/api/dashboard/floors"),
      fetch("/api/dashboard/activity"),
    ]);

    const kpiJson = await kpiRes.json();
    const binsJson = await binsRes.json();
    const floorsJson = await floorsRes.json();
    const activityJson = await activityRes.json();

    if (kpiJson.ok) setKpi(kpiJson.kpis);
    if (binsJson.ok) setBins(binsJson.rows);
    if (floorsJson.ok) setFloors(floorsJson.rows);
    if (activityJson.ok) setActivity(activityJson.rows);
  }

  async function openDrilldown(device_id: string) {
    setOpenDevice(device_id);
    const res = await fetch(`/api/dashboard/drilldown?device_id=${device_id}`);
    const json = await res.json();
    if (json.ok) setDrilldown(json.rows);
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {kpi && (
        <div className="grid grid-cols-4 gap-4">
          <div>Total bins: {kpi.total_bins}</div>
          <div>Total boxes: {kpi.total_boxes}</div>
          <div>Total IMEI: {kpi.total_imei}</div>
          <div>Alerts: {kpi.alerts}</div>
        </div>
      )}

      <div>
        <a
          href="/api/dashboard/export"
          className="rounded-lg border px-4 py-2 inline-block"
        >
          Export current stock
        </a>
      </div>

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">

{/* GRAPH */}
<div className="md:col-span-2" style={{height:320}}>

<ResponsiveContainer>

<BarChart data={chartData} barCategoryGap="30%">

<XAxis dataKey="device" />

<YAxis />

<Tooltip />

<Bar
 dataKey="stock"
 fill="#4DA3FF"
 radius={[4,4,0,0]}
 barSize={18}
/>

</BarChart>

</ResponsiveContainer>

</div>


{/* ACTIVITY */}
<div className="md:col-span-1">

<h2 className="text-xl font-semibold mb-3">Recent Activity</h2>

<div className="max-h-[320px] overflow-y-auto space-y-2 border p-3 rounded">

{activity.slice(0,50).map((a,i)=>(
<div key={i}>

<b>Batch {a.batch_id?.slice(0,8)}</b>

{" "} {a.type === "IN" ? "+" : "-"}

{a.qty} {a.device}

{" — "}

{new Date(a.created_at).toLocaleString()}

</div>
))}

</div>

</div>

</div>

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">

{/* GRAPH */}
<div style={{height:300}}>

<ResponsiveContainer>

<BarChart data={chartData} barCategoryGap="30%">

<XAxis dataKey="device" />

<YAxis />

<Tooltip />

<Bar
 dataKey="stock"
 fill="#4DA3FF"
 radius={[4,4,0,0]}
 barSize={18}
/>

</BarChart>

</ResponsiveContainer>

</div>


{/* ACTIVITY */}
<div>

<h2 className="text-xl font-semibold mb-3">Recent Activity</h2>

<div className="max-h-[300px] overflow-y-auto space-y-2 border p-3 rounded">

{activity.slice(0,50).map((a,i)=>(
<div key={i}>

<b>Batch {a.batch_id?.slice(0,8)}</b>

{" "} {a.type === "IN" ? "+" : "-"}

{a.qty} {a.device}

{" — "}

{new Date(a.created_at).toLocaleString()}

</div>
))}

</div>

</div>

</div>

      <div>
        <h2 className="text-xl font-semibold mb-3">Bins</h2>
        <table className="w-full border">
          <thead>
            <tr>
              <th>Device</th>
              <th>Boxes</th>
              <th>IMEI</th>
              <th>Min stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {bins.map((b) => (
              <tr
                key={b.device_id}
                className="cursor-pointer"
                onClick={() => openDrilldown(b.device_id)}
              >
                <td>{b.device}</td>
                <td>{b.boxes_count}</td>
                <td>{b.imei_count}</td>
                <td>{b.min_stock}</td>
                <td>

<span
 className={
  b.level === "ok"
   ? "text-green-500"
   : b.level === "low"
   ? "text-orange-500"
   : "text-red-500"
 }
>

{b.level}

</span>

</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openDevice && (
        <div>
          <h2 className="text-xl font-semibold mb-3">Drilldown</h2>
          <table className="w-full border">
            <thead>
              <tr>
                <th>Box</th>
                <th>Floor</th>
                <th>Remaining</th>
                <th>Total ever</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {drilldown.map((d) => (
                <tr key={d.box_id}>
                  <td>{d.box_code}</td>
                  <td>{d.floor}</td>
                  <td>{d.remaining}</td>
                  <td>{d.total_ever}</td>
                  <td>{d.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold mb-3">Floors</h2>
        <table className="w-full border">
          <thead>
            <tr>
              <th>Floor</th>
              <th>Device</th>
              <th>Boxes</th>
              <th>IMEI</th>
            </tr>
          </thead>
          <tbody>
            {floors.map((f, i) => (
              <tr key={`${f.floor}-${f.device_id}-${i}`}>
                <td>{f.floor}</td>
                <td>{f.device}</td>
                <td>{f.boxes_count}</td>
                <td>{f.imei_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}