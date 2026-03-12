"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
 BarChart,
 Bar,
 XAxis,
 YAxis,
 Tooltip,
 ResponsiveContainer,
 Legend,
 CartesianGrid
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
const [editingMinStock, setEditingMinStock] = useState<string | null>(null);

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
  fetch("/api/dashboard/summary", { cache: "no-store" }),
  fetch("/api/dashboard/bins", { cache: "no-store" }),
  fetch("/api/dashboard/floors", { cache: "no-store" }),
  fetch("/api/dashboard/activity", { cache: "no-store" }),
  fetch("/api/dashboard/device-flow", { cache: "no-store" }),
  fetch("/api/dashboard/sales", { cache: "no-store" }),
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
 setTopDevices(salesJson.rows)
}

}
 
 async function openDrilldown(device_id: string) {

 setOpenDevice(device_id);

 const res = await fetch(`/api/dashboard/drilldown?device_id=${device_id}`);
 const json = await res.json();

 if (json.ok) setDrilldown(json.rows);

 }

 useEffect(() => {

  loadAll();

  const interval = setInterval(() => {
    loadAll();
  }, 5000); // refresh toutes les 5s

  return () => clearInterval(interval);

}, []);

 return (

<div className="pt-4 px-10 pb-10 space-y-10 max-w-[1500px] mx-auto">

<div className="flex items-center justify-between">

<div className="flex items-center gap-3">
  <a
    href="/api/dashboard/export"
    className="card-glow px-5 py-2 rounded-lg text-sm flex items-center gap-2 hover:opacity-90"
  >
    Export Stock
  </a>

  <a
    href="/api/dashboard/export-count-sheet"
    className="card-glow px-5 py-2 rounded-lg text-sm flex items-center gap-2 hover:opacity-90"
  >
    Export Count Sheet
  </a>
</div>

<h1 className="text-3xl font-semibold tracking-tight">
Inventory Dashboard
</h1>

<div className="w-[120px]"></div>

</div>

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

{/* GRAPH */}

<div className="card-glow p-6 rounded-xl">

{/* GRAPH */}

<div className="card-glow p-2 rounded-xl md:col-span-3">

<h2 className="text-lg font-semibold mb-6">
Device Flow Overview
</h2>

<div className="h-[520px]">

<ResponsiveContainer width="100%" height="100%">

<BarChart
 data={chartData}
 barCategoryGap="20%"
 margin={{ top: 30, right: 20, left: 0, bottom: 30 }}
>

<CartesianGrid
 strokeDasharray="3 3"
 stroke="rgba(255,255,255,0.05)"
/>

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
 domain={[0,'auto']}
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
/>

<Bar
 dataKey="out"
 fill="#a855f7"
 name="Outbound"
 radius={[6,6,0,0]}
 barSize={36}
/>

</BarChart>

</ResponsiveContainer>
</div>
</div>
</div>

{/* ANALYTICS */}

<div className="grid md:grid-cols-4 gap-6">

<div className="card-glow p-5 rounded-xl">

<div className="text-xs text-slate-400 mb-1">
Devices sold this month
</div>

<div className="text-3xl font-bold text-purple-400">
{salesTable.reduce((a,b)=>a+b.total_out,0)}
</div>

</div>


<div className="card-glow p-5 rounded-xl">

<div className="text-xs text-slate-400 mb-1">
Top device
</div>

<div className="text-xl font-semibold text-cyan-400">
{topDevices[0]?.device || "-"}
</div>

</div>


<div className="card-glow p-5 rounded-xl">

<div className="text-xs text-slate-400 mb-1">
IMEI in stock
</div>

<div className="text-3xl font-bold text-cyan-400">
{kpi?.total_imei ?? 0}
</div>

</div>


<div className="card-glow p-5 rounded-xl">

<div className="text-xs text-slate-400 mb-1">
Low stock alerts
</div>

<div className="text-3xl font-bold text-orange-400">
{bins.filter(b => b.min_stock && b.imei_count <= b.min_stock).length}
</div>

</div>

</div>

{/* ACTIVITY + SALES */}

<div className="grid md:grid-cols-2 gap-6">

{/* RECENT ACTIVITY */}

<div className="card-glow p-5 rounded-xl">

<h2 className="text-md font-semibold mb-4">
Recent Activity
</h2>

<div className="max-h-[320px] overflow-y-auto space-y-3 text-sm pr-2">

{activity.slice(0,20).map((a,i)=>(

<div key={i} className="flex justify-between items-center">

<div className={
a.type === "IN"
? "text-green-400 font-semibold"
: a.type === "OUT"
? "text-red-400 font-semibold"
: "text-cyan-400 font-semibold"
}>

{a.type === "IN" && (
<>
+{a.qty} {a.device}
</>
)}

{a.type === "OUT" && (
<>
-{a.qty} {a.device}
</>
)}

{a.type === "TRANSFER" && (
<>
🔁 Box {a.box_code} ({a.device}) {a.from_floor} → {a.to_floor}
</>
)}

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


{/* TOP SELLING DEVICES */}

<div
className="card-glow p-6 rounded-xl cursor-pointer hover:bg-white/5 transition"
onClick={()=>setShowSales(!showSales)}
>

<h2 className="text-lg font-semibold mb-4">
Top Selling Devices (This Month)
</h2>

<div className="space-y-4 max-h-[320px] overflow-y-auto pr-2">

{topDevices.map((d)=>{

const total = salesTable.reduce((a,b)=>a+b.total_out,0)
const percent = total ? Math.round((d.total_out/total)*100) : 0

return(

<div key={d.device}>

<div className="flex justify-between text-sm mb-1">

<span className="text-cyan-400 font-semibold">
{d.device}
</span>

<span className="text-slate-400">
{d.total_out} sold • {percent}%
</span>

</div>

<div className="w-full bg-white/10 h-2 rounded">

<div
className="bg-purple-500 h-2 rounded"
style={{width:`${percent}%`}}
/>

</div>

</div>

)

})}

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
else if (b.min_stock && b.imei_count <= b.min_stock) {
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

{editingMinStock === b.device_id ? (

<input
type="number"
defaultValue={b.min_stock ?? 0}
autoFocus
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

 setBins(prev =>
  prev.map(item =>
   item.device_id === b.device_id
    ? { ...item, min_stock:value }
    : item
  )
 )

 setEditingMinStock(null)

}}
/>

) : (

<div
className="cursor-pointer flex items-center gap-2 text-slate-300 hover:text-white transition"
onClick={(e)=>{
 e.stopPropagation()
 setEditingMinStock(b.device_id)
}}
>

<span>{b.min_stock ?? 0}</span>

<span className="text-xs text-slate-500">🔒</span>

</div>

)}

</td>

<td>

<span
className={`px-2 py-1 rounded text-xs font-semibold
 ${level === "ok" ? "bg-green-500/20 text-green-400" : ""}
 ${level === "low" ? "bg-yellow-500/20 text-yellow-400" : ""}
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