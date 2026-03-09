"use client";

import { useEffect, useState } from "react";
import {
 BarChart,
 Bar,
 XAxis,
 YAxis,
 Tooltip,
 ResponsiveContainer,
 Legend
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
  const [floors, setFloors] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [drilldown, setDrilldown] = useState<any[]>([]);
  const [openDevice, setOpenDevice] = useState<string | null>(null);

  const [search,setSearch] = useState("");
  const [boxSearch,setBoxSearch] = useState("");

  const filteredBins = bins.filter((b:any)=>
    b.device?.toLowerCase().includes(search.toLowerCase())
  );

  const chartData =
    filteredBins.map((b:any)=>({
      device: b.device,
      in: Number(b.total_in || b.imei_count || 0),
      out: Number(b.total_out || 0)
    })) || [];

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

  useEffect(()=>{ loadAll(); },[]);

  return (

<div className="p-8 space-y-8 max-w-[1400px] mx-auto">

<h1 className="text-2xl font-bold">Dashboard</h1>


{/* GLOBAL FILTER */}

<div className="card-glow p-4 rounded-xl">

<input
type="text"
placeholder="Search device..."
value={search}
onChange={(e)=>setSearch(e.target.value)}
className="bg-transparent outline-none w-full text-sm"
/>

</div>


{/* KPI */}

{kpi && (

<div className="grid grid-cols-2 md:grid-cols-4 gap-6">

<div className="card-glow p-5 rounded-xl">
<div className="text-sm text-slate-400">Total bins</div>
<div className="text-2xl font-semibold">{kpi.total_bins}</div>
</div>

<div className="card-glow p-5 rounded-xl">
<div className="text-sm text-slate-400">Total boxes</div>
<div className="text-2xl font-semibold">{kpi.total_boxes}</div>
</div>

<div className="card-glow p-5 rounded-xl">
<div className="text-sm text-slate-400">Total IMEI</div>
<div className="text-2xl font-semibold">{kpi.total_imei}</div>
</div>

<div className="card-glow p-5 rounded-xl">
<div className="text-sm text-slate-400">Alerts</div>
<div className="text-2xl font-semibold">{kpi.alerts}</div>
</div>

</div>

)}


{/* EXPORT */}

<div>

<a
href="/api/dashboard/export"
className="card-glow px-4 py-2 rounded-lg text-sm inline-block hover:opacity-90"
>
Export current stock
</a>

</div>


{/* GRAPH + ACTIVITY */}

<div className="grid grid-cols-1 md:grid-cols-3 gap-6">


{/* GRAPH */}

<div className="card-glow p-6 rounded-xl md:col-span-2" style={{height:340}}>

<h2 className="text-lg font-semibold mb-4">IN vs OUT by device</h2>

<ResponsiveContainer>

<BarChart data={chartData} barCategoryGap="30%">

<XAxis dataKey="device"/>
<YAxis/>
<Tooltip/>
<Legend/>

<Bar
dataKey="in"
fill="#38bdf8"
name="Inbound"
radius={[4,4,0,0]}
/>

<Bar
dataKey="out"
fill="#a855f7"
name="Outbound"
radius={[4,4,0,0]}
/>

</BarChart>

</ResponsiveContainer>

</div>


{/* ACTIVITY */}

<div className="card-glow p-6 rounded-xl">

<h2 className="text-lg font-semibold mb-4">Recent Activity</h2>

<div className="max-h-[260px] overflow-y-auto space-y-2 text-sm">

{activity.slice(0,50).map((a,i)=>(

<div key={i}>

<span className={
a.type === "IN"
? "text-green-400"
: "text-red-400"
}>
{a.type === "IN" ? "+" : "-"}{a.qty}
</span>

{" "} {a.device}

{" • "}

{new Date(a.created_at).toLocaleString("fr-BE",{
day:"2-digit",
month:"2-digit",
hour:"2-digit",
minute:"2-digit"
})}

</div>

))}

</div>

</div>

</div>


{/* BINS */}

<div className="card-glow p-6 rounded-xl">

<h2 className="text-lg font-semibold mb-4">Bins</h2>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400">
<th>Device</th>
<th>Boxes</th>
<th>IMEI</th>
<th>Min stock</th>
<th>Status</th>
</tr>

</thead>

<tbody>

{filteredBins.map((b)=>(
<tr
key={b.device_id}
className="cursor-pointer hover:bg-slate-800/30 transition"
onClick={()=>openDrilldown(b.device_id)}
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


{/* DRILLDOWN */}

{openDevice && (

<div className="card-glow p-6 rounded-xl">

<div className="flex justify-between items-center mb-4">

<h2 className="text-lg font-semibold">
Device {openDevice}
</h2>

<button
onClick={()=>setOpenDevice(null)}
className="text-sm border px-3 py-1 rounded hover:bg-slate-800"
>
Close
</button>

</div>

<input
type="text"
placeholder="Filter box..."
value={boxSearch}
onChange={(e)=>setBoxSearch(e.target.value)}
className="mb-4 bg-transparent border px-3 py-2 rounded text-sm"
/>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400">
<th>Box</th>
<th>Floor</th>
<th>Remaining</th>
<th>Total ever</th>
<th>%</th>
</tr>

</thead>

<tbody>

{drilldown
.filter((d:any)=>
d.box_code?.toLowerCase().includes(boxSearch.toLowerCase())
)
.map((d)=>(
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


{/* FLOORS */}

<div className="card-glow p-6 rounded-xl">

<h2 className="text-lg font-semibold mb-4">Floors</h2>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400">
<th>Floor</th>
<th>Device</th>
<th>Boxes</th>
<th>IMEI</th>
</tr>

</thead>

<tbody>

{floors.map((f,i)=>(
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