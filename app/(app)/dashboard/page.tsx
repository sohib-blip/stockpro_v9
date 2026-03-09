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
 const [topDevices,setTopDevices] = useState<any[]>([]);
const [showSales,setShowSales] = useState(false);
const [salesTable,setSalesTable] = useState<any[]>([]);

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

const [kpiRes, binsRes, floorsRes, activityRes, flowRes, salesRes] = await Promise.all([
 fetch("/api/dashboard/summary"),
 fetch("/api/dashboard/bins"),
 fetch("/api/dashboard/floors"),
 fetch("/api/dashboard/activity"),
 fetch("/api/dashboard/device-flow"),
 fetch("/api/dashboard/sales")
]);

 const kpiJson = await kpiRes.json();
 const binsJson = await binsRes.json();
 const floorsJson = await floorsRes.json();
 const activityJson = await activityRes.json();
 const flowJson = await flowRes.json();
 const salesJson = await salesRes.json();

 if (kpiJson.ok) setKpi(kpiJson.kpis);
 if (binsJson.ok) setBins(binsJson.rows);
 if (floorsJson.ok) setFloors(floorsJson.rows);
 if (activityJson.ok) setActivity(activityJson.rows);
 if (flowJson.ok) setFlow(flowJson.rows);
if (salesJson.ok){
 setSalesTable(salesJson.rows)
 setTopDevices(salesJson.rows.slice(0,3))
}

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

<div className="card-glow p-2 rounded-xl md:col-span-3">

<h2 className="text-lg font-semibold mb-6">
Device Flow Overview
</h2>

<div className="h-[480px]">

<ResponsiveContainer width="100%" height="100%">

<BarChart
 data={chartData}
 barCategoryGap="30%"
 margin={{ top: 30, right: 10, left: 0, bottom: 30 }}
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
 barSize={28}
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
 barSize={28}
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

{/* TOP SELLING DEVICES */}

<div
className="card-glow p-6 rounded-xl cursor-pointer hover:bg-white/5 transition"
onClick={()=>setShowSales(!showSales)}
>

<h2 className="text-lg font-semibold mb-4">
Top Selling Devices (This Month)
</h2>

<div className="space-y-3">

{topDevices.map((d,i)=>{

const percent = salesTable.length
 ? Math.round((d.total_out / salesTable.reduce((a,b)=>a+b.total_out,0)) * 100)
 : 0

return(

<div key={i} className="flex justify-between text-sm">

<div className="flex gap-3 items-center">

<span className="text-slate-400">
#{i+1}
</span>

<span className="font-semibold text-cyan-400">
{d.device}
</span>

</div>

<div className="flex gap-4">

<span className="text-purple-400">
{d.total_out}
</span>

<span className="text-slate-400">
{percent}%
</span>

</div>

</div>

)

})}

</div>

</div>

{showSales && (

<div className="card-glow p-6 rounded-xl">

<h2 className="text-lg font-semibold mb-5">
Device Sales Details
</h2>

<table className="w-full text-sm">

<thead>

<tr className="text-left text-slate-400 border-b border-white/5">
<th className="py-2">Device</th>
<th>Sold</th>
<th>%</th>
</tr>

</thead>

<tbody>

{salesTable.map((d,i)=>{

const total = salesTable.reduce((a,b)=>a+b.total_out,0)
const percent = total ? Math.round((d.total_out/total)*100) : 0

return(

<tr key={i} className="hover:bg-white/5">

<td className="py-2">{d.device}</td>
<td>{d.total_out}</td>
<td>{percent}%</td>

</tr>

)

})}

</tbody>

</table>

</div>

)}

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

{filteredBins.map((b)=>{

let level = "ok"

if (b.imei_count === 0) {
 level = "critical"
}
else if (b.imei_count < b.min_stock) {
 level = "low"
}

return (

<tr
key={b.device_id}
className={`cursor-pointer transition
 ${level === "low" ? "bg-orange-500/10" : ""}
 ${level === "critical" ? "bg-red-500/10" : ""}
 hover:bg-white/5`}
onClick={()=>openDrilldown(b.device_id)}
>

<td className="py-2">{b.device}</td>

<td>{b.boxes_count}</td>

<td>{b.imei_count}</td>

<td>

<input
type="number"
defaultValue={b.min_stock ?? 0}
className="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-sm"
onBlur={async(e)=>{

 const value = Number(e.target.value)

 await fetch("/api/bins/update-min-stock",{
  method:"POST",
  headers:{ "Content-Type":"application/json" },
  body:JSON.stringify({
   device_id:b.device_id,
   min_stock:value
  })
 })

}}
/>

</td>

<td>

<span
className={`px-2 py-1 rounded text-xs font-semibold
 ${level === "ok" ? "bg-green-500/20 text-green-400" : ""}
 ${level === "low" ? "bg-orange-500/20 text-orange-400" : ""}
 ${level === "critical" ? "bg-red-500/20 text-red-400" : ""}
`}
>

{level === "ok" && "OK"}
{level === "low" && "LOW"}
{level === "critical" && "EMPTY"}

</span>

</td>

</tr>

)

})}

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