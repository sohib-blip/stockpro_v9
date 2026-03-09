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
 const [flow,setFlow] = useState<any[]>([]);
 const [openDevice, setOpenDevice] = useState<string | null>(null);

 const [search,setSearch] = useState("");
 const [boxSearch,setBoxSearch] = useState("");

 const filteredBins = bins.filter((b:any)=>
  b.device?.toLowerCase().includes(search.toLowerCase())
 );

 const chartData = bins.map((b:any) => {

 const movement = flow.find((f:any)=>f.device === b.device);

 return {
  device: b.device,
  in: Number(movement?.total_in || 0),
  out: Number(movement?.total_out || 0)
 };

});

 const deviceName =
 bins.find((b:any)=>b.device_id === openDevice)?.device || openDevice;

 async function loadAll() {

const [kpiRes, binsRes, floorsRes, activityRes, flowRes] = await Promise.all([
 fetch("/api/dashboard/summary"),
 fetch("/api/dashboard/bins"),
 fetch("/api/dashboard/floors"),
 fetch("/api/dashboard/activity"),
 fetch("/api/dashboard/device-flow")
]);

 const kpiJson = await kpiRes.json();
 const binsJson = await binsRes.json();
 const floorsJson = await floorsRes.json();
 const activityJson = await activityRes.json();
 const flowJson = await flowRes.json();

 if (kpiJson.ok) setKpi(kpiJson.kpis);
 if (binsJson.ok) setBins(binsJson.rows);
 if (floorsJson.ok) setFloors(floorsJson.rows);
 if (activityJson.ok) setActivity(activityJson.rows);
 if (flowJson.ok) setFlow(flowJson.rows);

 }

 async function openDrilldown(device_id: string) {

 setOpenDevice(device_id);

 const res = await fetch(`/api/dashboard/drilldown?device_id=${device_id}`);
 const json = await res.json();

 if (json.ok) setDrilldown(json.rows);

 }

 useEffect(()=>{ loadAll(); },[]);

 return (

<div className="p-10 space-y-10 max-w-[1500px] mx-auto">

<h1 className="text-3xl font-semibold tracking-tight">
Inventory Dashboard
</h1>


{/* SEARCH */}

<div className="card-glow p-4 rounded-xl">

<input
type="text"
placeholder="Search device..."
value={search}
onChange={(e)=>setSearch(e.target.value)}
className="w-full text-sm bg-black/40 border border-white/10 rounded-lg px-4 py-2 outline-none"
/>

</div>


{/* KPI */}

{kpi && (

<div className="grid grid-cols-2 md:grid-cols-4 gap-6">

<div className="card-glow rounded-xl p-6 text-center">
<div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
Total bins
</div>
<div className="text-4xl font-bold text-cyan-400">
{kpi.total_bins}
</div>
</div>

<div className="card-glow rounded-xl p-6 text-center">
<div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
Total boxes
</div>
<div className="text-4xl font-bold text-cyan-400">
{kpi.total_boxes}
</div>
</div>

<div className="card-glow rounded-xl p-6 text-center">
<div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
Total IMEI
</div>
<div className="text-4xl font-bold text-cyan-400">
{kpi.total_imei}
</div>
</div>

<div className="card-glow rounded-xl p-6 text-center">
<div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">
Alerts
</div>
<div className="text-4xl font-bold text-purple-400">
{kpi.alerts}
</div>
</div>

</div>

)}


{/* EXPORT */}

<div>

<a
href="/api/dashboard/export"
className="card-glow px-5 py-2 rounded-lg text-sm inline-block hover:opacity-90"
>
Export current stock
</a>

</div>


{/* GRAPH + ACTIVITY */}

<div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">

{/* GRAPH */}

<div className="card-glow p-8 rounded-xl md:col-span-3">

<h2 className="text-lg font-semibold mb-6">
Device Flow Overview
</h2>

<div className="h-[420px]">

<ResponsiveContainer width="100%" height="100%">

<BarChart
 data={chartData}
 barCategoryGap="25%"
 margin={{ top: 40, right: 20, left: 10, bottom: 90 }}
>

<XAxis
  dataKey="device"
  angle={-90}
  textAnchor="end"
  interval={0}
  height={110}
  tick={{ fill:"#94a3b8", fontSize:12 }}
/>

<YAxis
 allowDecimals={false}
 domain={[0, 'auto']}
 tick={{ fill:"#94a3b8", fontSize:12 }}
/>

<Tooltip
 contentStyle={{
  background:"#020617",
  border:"1px solid rgba(255,255,255,0.08)",
  borderRadius:"10px"
 }}
/>

<Legend/>

<Bar
 dataKey="in"
 fill="#38bdf8"
 name="Inbound"
 radius={[6,6,0,0]}
 barSize={36}
 label={(props:any)=>{
  if(!props.value) return null
  return (
   <text
    x={props.x + props.width/2}
    y={props.y - 8}
    textAnchor="middle"
    fill="#e2e8f0"
    fontSize="13"
    fontWeight="600"
   >
    {props.value}
   </text>
  )
 }}
/>

<Bar
 dataKey="out"
 fill="#a855f7"
 name="Outbound"
 radius={[6,6,0,0]}
 barSize={36}
 label={(props:any)=>{
  if(!props.value) return null
  return (
   <text
    x={props.x + props.width/2}
    y={props.y - 8}
    textAnchor="middle"
    fill="#e2e8f0"
    fontSize="13"
    fontWeight="600"
   >
    {props.value}
   </text>
  )
 }}
/>

</BarChart>

</ResponsiveContainer>

</div>

</div>


{/* ACTIVITY */}

<div className="card-glow p-5 rounded-xl md:col-span-1">

<h2 className="text-md font-semibold mb-4">
Recent Activity
</h2>

<div className="max-h-[360px] overflow-y-auto space-y-3 text-sm">

{activity.slice(0,40).map((a,i)=>(

<div key={i} className="flex justify-between items-center">

<div className={
a.type === "IN"
? "text-green-400 font-semibold"
: "text-red-400 font-semibold"
}>
{a.type === "IN" ? "+" : "-"}{a.qty} {a.device}
</div>

<div className="text-slate-400 text-xs">
{new Date(a.created_at).toLocaleString("fr-BE",{
day:"2-digit",
month:"2-digit",
hour:"2-digit",
minute:"2-digit"
})}
</div>

</div>

))}

</div>

</div>

</div>


{/* BINS */}

<div className="card-glow p-6 rounded-xl">

<h2 className="text-lg font-semibold mb-5">
Bins
</h2>

<table className="w-full text-sm border-collapse">

<thead>

<tr className="text-left text-slate-400 border-b border-white/5">
<th className="py-2">Device</th>
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
className="cursor-pointer hover:bg-white/5 transition"
onClick={()=>openDrilldown(b.device_id)}
>

<td className="py-2">{b.device}</td>
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

<div className="flex justify-between items-center mb-5">

<h2 className="text-lg font-semibold">
Device {deviceName}
</h2>

<button
onClick={()=>setOpenDevice(null)}
className="text-sm border px-3 py-1 rounded hover:bg-white/10"
>
Close
</button>

</div>

<input
type="text"
placeholder="Filter box..."
value={boxSearch}
onChange={(e)=>setBoxSearch(e.target.value)}
className="mb-4 w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm outline-none"
/>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400 border-b border-white/5">
<th className="py-2">Box</th>
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

<td className="py-2">{d.box_code}</td>
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

<h2 className="text-lg font-semibold mb-5">
Floors
</h2>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400 border-b border-white/5">
<th className="py-2">Floor</th>
<th>Device</th>
<th>Boxes</th>
<th>IMEI</th>
</tr>

</thead>

<tbody>

{floors.map((f,i)=>(
<tr key={`${f.floor}-${f.device_id}-${i}`}>

<td className="py-2">{f.floor}</td>
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