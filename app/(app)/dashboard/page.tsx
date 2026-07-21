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
import AccessoryCategory from "@/components/dashboard/AccessoryCategory";

type KPI = {
 total_bins: number;
 total_boxes: number;
 total_imei: number;
 alerts: number;
};

export default function DashboardPage() {

 const [kpi, setKpi] = useState<KPI | null>(null);
 const [bins, setBins] = useState<any[]>([]);
 const [accessories, setAccessories] = useState<any[]>([]);
 const [accessoryKpis, setAccessoryKpis] = useState<any>(null);
 const [accessorySearch, setAccessorySearch] = useState("");
 const [activity, setActivity] = useState<any[]>([]);
 const [drilldown, setDrilldown] = useState<any[]>([]);
 const [flow,setFlow] = useState<any[]>([]);
 const [openDevice, setOpenDevice] = useState<string | null>(null);
 const [topDevices,setTopDevices] = useState<any[]>([]);
 const [salesTable,setSalesTable] = useState<any[]>([]);
 const [editingMinStock, setEditingMinStock] = useState<string | null>(null);

 const [search,setSearch] = useState("");
 const [boxSearch,setBoxSearch] = useState("");

 const [openGroups, setOpenGroups] = useState({
  Packages: false,
  Vision: false,
  Harness: false,
  Consumables: false,
  Items: false,
});

function toggleGroup(category: keyof typeof openGroups) {
  setOpenGroups((prev) => ({
    ...prev,
    [category]: !prev[category],
  }));
}

 const filteredBins = bins
 .filter((b:any) => Number(b.imei_count) > 0)
 .filter((b:any) =>
  b.device?.toLowerCase().includes(search.toLowerCase())
 );

 const filteredAccessories = accessories.filter((a:any) =>
  a.name?.toLowerCase().includes(accessorySearch.toLowerCase()) ||
  a.bin?.toLowerCase().includes(accessorySearch.toLowerCase())
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

 const groupedAccessories = {
  Packages: filteredAccessories.filter(
    (a: any) => a.category === "Packages"
  ),

  Vision: filteredAccessories.filter(
    (a: any) => a.category === "Vision"
  ),

  Harness: filteredAccessories.filter(
    (a: any) => a.category === "Harness"
  ),

  Consumables: filteredAccessories.filter(
    (a: any) => a.category === "Consumables"
  ),

  Items: filteredAccessories.filter(
  (a: any) => a.category === "Items"
),
};

 async function loadAll() {

const [kpiRes, binsRes, activityRes, flowRes, salesRes, accessoriesRes] = await Promise.all([
  fetch("/api/dashboard/summary", { cache: "no-store" }),
  fetch("/api/dashboard/bins", { cache: "no-store" }),
  fetch("/api/dashboard/activity", { cache: "no-store" }),
  fetch("/api/dashboard/device-flow", { cache: "no-store" }),
  fetch("/api/dashboard/sales", { cache: "no-store" }),
  fetch("/api/dashboard/accessories", { cache: "no-store" }),
]);

 const kpiJson = await kpiRes.json();
 const binsJson = await binsRes.json();
 const accessoriesJson = await accessoriesRes.json();
 const activityJson = await activityRes.json();
 const flowJson = await flowRes.json();
 const salesJson = await salesRes.json();

 if (kpiJson.ok) setKpi(kpiJson.kpis);
 if (binsJson.ok) setBins(binsJson.rows);
 if (accessoriesJson.ok) {
  setAccessories(accessoriesJson.rows || []);
  setAccessoryKpis(accessoriesJson.kpis || null);
}
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
}, []);

 return (

<div className="w-full space-y-8 pb-10">

<div className="sp-page-header">
  <div>
    <div className="sp-eyebrow">Inventory</div>
    <h1 className="sp-title">Inventory Dashboard</h1>
    <p className="sp-desc">Stock, movement, and accessory overview</p>
  </div>

  <div className="flex flex-wrap items-center gap-2">
    <a
      href="/api/dashboard/export"
      className="sp-btn sp-btn-ghost"
    >
      Export Stock
    </a>

    <a
      href="/api/dashboard/export-count-sheet"
      className="sp-btn sp-btn-ghost"
    >
      Export Count Sheet
    </a>

    <button
      onClick={() => window.open("/api/accessory-bins/export", "_blank")}
      className="sp-btn sp-btn-ghost"
    >
      Export Accessories
    </button>
  </div>
</div>

{/* SEARCH */}

<div className="sp-card sp-card-tight">

<input
type="text"
placeholder="Search device..."
value={search}
onChange={(e)=>setSearch(e.target.value)}
className="sp-input"
/>

</div>


{/* KPI */}

{kpi && (

<div className="grid grid-cols-2 md:grid-cols-4 gap-6">

<div className="sp-card">
<div className="sp-kpi-label">
Total bins
</div>
<div className="sp-kpi-value">
{kpi.total_bins}
</div>
</div>

<div className="sp-card">
<div className="sp-kpi-label">
Total boxes
</div>
<div className="sp-kpi-value">
{kpi.total_boxes}
</div>
</div>

<div className="sp-card">
<div className="sp-kpi-label">
Total IMEI
</div>
<div className="sp-kpi-value">
{kpi.total_imei}
</div>
</div>

<div className="sp-card">
<div className="sp-kpi-label">
Alerts
</div>
<div className="sp-kpi-value">
{kpi.alerts}
</div>
</div>

</div>

)}

{/* GRAPH */}

<div className="sp-card">

{/* GRAPH */}

<div className="md:col-span-3">

<h2 className="mb-6 text-lg font-semibold text-sp-text">
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
 stroke="#e6e4de"
/>

<XAxis
 dataKey="device"
 angle={-90}
 textAnchor="end"
 interval={0}
 height={110}
 tick={{ fill:"#8a8f9b", fontSize:12 }}
/>

<YAxis
 allowDecimals={false}
 domain={[0,'auto']}
 tick={{ fill:"#8a8f9b", fontSize:12 }}
/>

<Tooltip
 contentStyle={{
  background:"#ffffff",
  border:"1px solid #e6e4de",
  borderRadius:"8px",
  color:"#20242c"
 }}
 labelStyle={{ color:"#20242c" }}
 itemStyle={{ color:"#3a4150" }}
/>

<Legend/>

<Bar
 dataKey="in"
 fill="#1d4ed8"
 name="Inbound"
 radius={[6,6,0,0]}
 barSize={36}
/>

<Bar
 dataKey="out"
 fill="#047857"
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

<div className="sp-card sp-card-tight">

<div className="sp-kpi-label">
Devices sold this month
</div>

<div className="sp-kpi-value">
{salesTable.reduce((a,b)=>a+b.total_out,0)}
</div>

</div>


<div className="sp-card sp-card-tight">

<div className="sp-kpi-label">
Top device
</div>

<div className="sp-kpi-value">
{topDevices[0]?.device || "-"}
</div>

</div>


<div className="sp-card sp-card-tight">

<div className="sp-kpi-label">
IMEI in stock
</div>

<div className="sp-kpi-value">
{kpi?.total_imei ?? 0}
</div>

</div>


<div className="sp-card sp-card-tight">

<div className="sp-kpi-label">
Low stock alerts
</div>

<div className="sp-kpi-value">
{bins.filter(b => b.min_stock && b.imei_count <= b.min_stock).length}
</div>

</div>

</div>

{/* ACTIVITY + SALES */}

<div className="grid md:grid-cols-2 gap-6">

{/* RECENT ACTIVITY */}

<div className="sp-card">

<h2 className="mb-4 text-md font-semibold text-sp-text">
Recent Activity
</h2>

<div className="max-h-[320px] overflow-y-auto space-y-3 text-sm pr-2">

{activity.slice(0,20).map((a,i)=>(

<div key={i} className="flex justify-between items-center">

<div className={
a.type === "IN"
? "text-sp-ok font-semibold"
: a.type === "OUT"
? "text-sp-err font-semibold"
: a.type === "RETURN"
? "text-sp-ok font-semibold"
: "text-sp-info font-semibold"
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

{a.type === "RETURN" && (
<>
↩️ Return {a.qty} {a.device}
</>
)}

{a.type === "TRANSFER" && (
<>
🔁 Box {a.box_code} ({a.device}) {a.from_floor} → {a.to_floor}
</>
)}

</div>
<div className="text-xs text-sp-muted">
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
className="sp-card cursor-pointer transition-colors hover:bg-sp-bg-soft"
>

<h2 className="mb-4 text-lg font-semibold text-sp-text">
Top Selling Devices (This Month)
</h2>

<div className="space-y-4 max-h-[320px] overflow-y-auto pr-2">

{topDevices.map((d)=>{

const total = salesTable.reduce((a,b)=>a+b.total_out,0)
const percent = total ? Math.round((d.total_out/total)*100) : 0

return(

<div key={d.device}>

<div className="flex justify-between text-sm mb-1">

<span className="font-semibold text-sp-primary">
{d.device}
</span>

<span className="text-sp-muted">
{d.total_out} sold • {percent}%
</span>

</div>

<div className="h-2 w-full rounded bg-sp-border">

<div
className="h-2 rounded bg-sp-primary"
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

<div className="sp-card sp-card-flush">

<h2 className="px-6 pb-4 pt-5 text-lg font-semibold text-sp-text">
Bins
</h2>

<div className="overflow-x-auto">
<table className="sp-table">

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
 ${level === "low" ? "bg-sp-warn-bg" : ""}
 ${level === "critical" ? "bg-sp-err-bg" : ""}`}
onClick={()=>openDrilldown(b.device_id)}
>

<td>{b.device}</td>

<td>{b.boxes_count}</td>

<td>{b.imei_count}</td>

<td>

{editingMinStock === b.device_id ? (

<input
type="number"
value={b.min_stock ?? 0}
autoFocus
className="sp-input w-16 py-1"

onChange={(e)=>{

 const value = Number(e.target.value)

 setBins(prev =>
  prev.map(item =>
   item.device_id === b.device_id
    ? { ...item, min_stock:value }
    : item
  )
 )

}}

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

 setEditingMinStock(null)

}}
/>

) : (

<div
className="flex cursor-pointer items-center gap-2 text-sp-body transition-colors hover:text-sp-primary"
onClick={(e)=>{
 e.stopPropagation()
 setEditingMinStock(b.device_id)
}}
>

<span>{b.min_stock ?? 0}</span>

<span className="text-xs text-sp-muted">🔒</span>

</div>

)}

</td>

<td>

<span
className={`sp-badge
 ${level === "ok" ? "sp-badge-ok" : ""}
 ${level === "low" ? "sp-badge-low" : ""}
 ${level === "critical" ? "sp-badge-empty" : ""}
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

</div>


{/* DRILLDOWN */}

{openDevice && (

<div className="sp-card">

<div className="flex justify-between items-center mb-5">

<h2 className="text-lg font-semibold text-sp-text">
Device {deviceName}
</h2>

<button
onClick={()=>setOpenDevice(null)}
className="sp-btn sp-btn-ghost"
>
Close
</button>

</div>

<input
type="text"
placeholder="Filter box..."
value={boxSearch}
onChange={(e)=>setBoxSearch(e.target.value)}
className="sp-input mb-4"
/>

<div className="overflow-x-auto">
<table className="sp-table">

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

{drilldown
.filter((d:any) => Number(d.remaining) > 0)
.filter((d:any) =>
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

</div>

)}


{/* ACCESSORIES STOCK */}

<div className="sp-card">

<div className="mb-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
  <h2 className="text-lg font-semibold text-sp-text">
    Accessories Stock
  </h2>

  <input
    type="text"
    placeholder="Search accessory or bin..."
    value={accessorySearch}
    onChange={(e)=>setAccessorySearch(e.target.value)}
    className="sp-input sm:w-[300px]"
  />
</div>

{accessoryKpis && (
  <div className="grid md:grid-cols-4 gap-4 mb-6">

    <div className="sp-card sp-card-tight">
      <div className="sp-kpi-label">Accessories</div>
      <div className="sp-kpi-value">
        {accessoryKpis.total_accessories}
      </div>
    </div>

    <div className="sp-card sp-card-tight">
      <div className="sp-kpi-label">Total Qty</div>
      <div className="sp-kpi-value">
        {accessoryKpis.total_qty}
      </div>
    </div>

    <div className="sp-card sp-card-tight">
      <div className="sp-kpi-label">Low Stock</div>
      <div className="sp-kpi-value">
        {accessoryKpis.low_stock}
      </div>
    </div>

    <div className="sp-card sp-card-tight">
      <div className="sp-kpi-label">Empty</div>
      <div className="sp-kpi-value">
        {accessoryKpis.empty_stock}
      </div>
    </div>

  </div>
)}

<div className="space-y-3">
  <AccessoryCategory
    title="Packages"
    items={groupedAccessories.Packages}
    open={openGroups.Packages}
    onToggle={() => toggleGroup("Packages")}
  />

  <AccessoryCategory
    title="Vision"
    items={groupedAccessories.Vision}
    open={openGroups.Vision}
    onToggle={() => toggleGroup("Vision")}
  />

  <AccessoryCategory
    title="Harness"
    items={groupedAccessories.Harness}
    open={openGroups.Harness}
    onToggle={() => toggleGroup("Harness")}
  />

  <AccessoryCategory
    title="Consumables"
    items={groupedAccessories.Consumables}
    open={openGroups.Consumables}
    onToggle={() => toggleGroup("Consumables")}
  />

  <AccessoryCategory
  title="Items"
  items={groupedAccessories.Items}
  open={openGroups.Items}
  onToggle={() => toggleGroup("Items")}
/>
</div>

</div>

</div>

);
}
