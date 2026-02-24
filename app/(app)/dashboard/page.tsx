"use client";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [filterDevice, setFilterDevice] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [selectedBox, setSelectedBox] = useState<any>(null);
  const [editingMinStock, setEditingMinStock] = useState<Record<string, number>>({});

  async function load() {
    const res = await fetch("/api/dashboard/overview");
    const json = await res.json();
    if (json.ok) setData(json);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateMinStock(device_id: string) {
    await fetch("/api/dashboard/update-minstock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id,
        min_stock: editingMinStock[device_id],
      }),
    });

    load();
  }

  if (!data) return <div className="p-6">Loading...</div>;

  const filteredDevices = data.deviceSummary.filter((d: any) =>
    d.device.toLowerCase().includes(filterDevice.toLowerCase())
  );

  const lowStockDevices = data.deviceSummary.filter(
    (d: any) => d.total_imei <= (d.min_stock ?? 0)
  );

  return (
    <div className="space-y-8 max-w-6xl">

      <h2 className="text-xl font-semibold">Inventory Dashboard</h2>

      {/* 🔴 LOW STOCK ALERT */}
      {lowStockDevices.length > 0 && (
        <div className="bg-rose-600 p-4 rounded text-white">
          ⚠️ Low Stock Alert:
          <ul className="mt-2 list-disc ml-6">
            {lowStockDevices.map((d: any) => (
              <li key={d.device_id}>
                {d.device} — {d.total_imei} IMEI remaining (Min: {d.min_stock})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-4 gap-4">
        <KPI label="Devices" value={data.kpis.total_devices} />
        <KPI label="IMEI IN" value={data.kpis.total_imei} />
        <KPI label="Boxes" value={data.kpis.total_boxes} />
        <KPI label="Floors" value={data.kpis.total_floors} />
      </div>

      <button
        onClick={() => window.open("/api/dashboard/export")}
        className="bg-indigo-600 px-4 py-2 rounded text-white"
      >
        Export Excel
      </button>

      <input
        placeholder="Filter by device"
        value={filterDevice}
        onChange={(e) => setFilterDevice(e.target.value)}
        className="border p-2 w-full"
      />

      {/* DEVICES TABLE */}
      <table className="w-full border">
        <thead>
          <tr>
            <th>Device</th>
            <th>IMEI</th>
            <th>Boxes</th>
            <th>Floors</th>
            <th>Min Stock</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredDevices.map((d: any) => (
            <tr key={d.device_id}>
              <td>{d.device}</td>
              <td className={d.total_imei <= d.min_stock ? "text-red-600 font-bold" : ""}>
                {d.total_imei}
              </td>
              <td>{d.total_boxes}</td>
              <td>{d.floors.join(", ")}</td>

              <td>
                <input
                  type="number"
                  defaultValue={d.min_stock}
                  onChange={(e) =>
                    setEditingMinStock({
                      ...editingMinStock,
                      [d.device_id]: Number(e.target.value),
                    })
                  }
                  className="border p-1 w-20"
                />
              </td>

              <td>
                <button
                  onClick={() => updateMinStock(d.device_id)}
                  className="bg-emerald-600 text-white px-2 py-1 rounded"
                >
                  Save
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* BOX DRILLDOWN */}
      {selectedDevice && (
        <div>
          <h3>Boxes for {selectedDevice.device}</h3>

          {data.boxes
            .filter((b: any) => b.bin_id === selectedDevice.device_id)
            .map((b: any) => (
              <div
                key={b.id}
                onClick={() => setSelectedBox(b)}
                className="border p-2 cursor-pointer"
              >
                Box: {b.id} | Floor: {b.floor}
              </div>
            ))}
        </div>
      )}

      {/* IMEI DRILLDOWN */}
      {selectedBox && (
        <div>
          <h3>IMEIs in Box {selectedBox.id}</h3>
          <ul>
            {data.items
              .filter((i: any) =>
                i.box_id === selectedBox.id && i.status === "IN"
              )
              .map((i: any) => (
                <li key={i.imei}>{i.imei}</li>
              ))}
          </ul>
        </div>
      )}

    </div>
  );
}

function KPI({ label, value }: any) {
  return (
    <div className="border p-4 rounded">
      <div className="text-sm">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}