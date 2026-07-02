"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Bin = {
  id: string;
  name: string;
};

export default function BinsPage() {
  const supabase = createSupabaseBrowserClient();

  const [bins, setBins] = useState<Bin[]>([]);
  const [accessoryBins, setAccessoryBins] = useState<Bin[]>([]);
  const [accessories, setAccessories] = useState<any[]>([]);

  const [newBin, setNewBin] = useState("");
  const [newAccessoryBin, setNewAccessoryBin] = useState("");

  const [accessoryName, setAccessoryName] = useState("");
  const [accessoryBinId, setAccessoryBinId] = useState("");
  const [stock, setStock] = useState(0);
  const [minStock, setMinStock] = useState(0);

  const [selectedDevice, setSelectedDevice] = useState<Bin | null>(null);
  const [templateAccessories, setTemplateAccessories] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateAccessoryId, setTemplateAccessoryId] = useState("");
  const [templateQty, setTemplateQty] = useState(1);
  const [templatePerDevices, setTemplatePerDevices] = useState(1);

  const [loading, setLoading] = useState(false);

  async function loadBins() {
    const { data } = await supabase
      .from("bins")
      .select("*")
      .order("created_at", { ascending: false });

    setBins(data || []);
  }

  async function loadAccessoryBins() {
    const res = await fetch(`/api/accessory-bins/list?t=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) setAccessoryBins(json.rows || []);
  }

  async function loadAccessories() {
    const res = await fetch(`/api/accessories/list?t=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) setAccessories(json.rows || []);
  }

  async function addBin() {
    if (!newBin.trim()) return;

    setLoading(true);
    await supabase.from("bins").insert({ name: newBin.trim() });

    setNewBin("");
    setLoading(false);
    loadBins();
  }

  async function addAccessoryBin() {
    if (!newAccessoryBin.trim()) return;

    setLoading(true);

    await fetch("/api/accessory-bins/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newAccessoryBin }),
    });

    setNewAccessoryBin("");
    setLoading(false);
    loadAccessoryBins();
  }

  async function addAccessory() {
    if (!accessoryName.trim()) return;

    setLoading(true);

    await fetch("/api/accessories/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: accessoryName,
        stock,
        minimum_stock: minStock,
        accessory_bin_id: accessoryBinId || null,
      }),
    });

    setAccessoryName("");
    setAccessoryBinId("");
    setStock(0);
    setMinStock(0);
    setLoading(false);

    loadAccessories();
  }

  async function deleteBin(id: string) {
    await supabase.from("bins").delete().eq("id", id);
    loadBins();
  }

  async function openTemplate(bin: Bin) {
    setSelectedDevice(bin);

    const res = await fetch(
      `/api/bins/templates/list?device_id=${bin.id}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json.ok) {
      setTemplateAccessories(json.accessories || []);
      setTemplates(json.templates || []);
    }
  }

  async function saveTemplate() {
    if (!selectedDevice || !templateAccessoryId) return;

    setLoading(true);

    await fetch("/api/bins/templates/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: selectedDevice.id,
        accessory_id: templateAccessoryId,
        quantity: templateQty,
        per_devices: templatePerDevices,
      }),
    });

    setTemplateAccessoryId("");
    setTemplateQty(1);
    setTemplatePerDevices(1);
    setLoading(false);

    openTemplate(selectedDevice);
  }

  useEffect(() => {
    loadBins();
    loadAccessoryBins();
    loadAccessories();
  }, []);

  return (
    <div className="space-y-10 max-w-6xl">
      <h1 className="text-xl font-semibold">Bins</h1>

      {/* DEVICE BINS */}
      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Device Bins</div>

        <div className="flex gap-2 items-center">
          <input
            value={newBin}
            onChange={(e) => setNewBin(e.target.value)}
            placeholder="New device bin..."
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-64"
          />

          <button
            onClick={addBin}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {bins.map((bin) => (
                <tr key={bin.id} className="border-t border-slate-800">
                  <td className="p-3">{bin.name}</td>
                  <td className="p-3 text-right space-x-4">
                    <button
                      onClick={() => openTemplate(bin)}
                      className="text-cyan-400 hover:text-cyan-300"
                    >
                      Template
                    </button>

                    <button
                      onClick={() => deleteBin(bin.id)}
                      className="text-rose-400 hover:text-rose-500"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {bins.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-4 text-center text-slate-500">
                    No device bins yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* TEMPLATE EDITOR */}
      {selectedDevice && (
        <div className="card-glow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              Template for {selectedDevice.name}
            </div>

            <button
              onClick={() => setSelectedDevice(null)}
              className="text-sm border border-slate-800 px-3 py-1 rounded-lg hover:bg-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={templateAccessoryId}
              onChange={(e) => setTemplateAccessoryId(e.target.value)}
              className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
            >
              <option value="">Select accessory</option>
              {templateAccessories.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              value={templateQty}
              onChange={(e) => setTemplateQty(Number(e.target.value))}
              placeholder="Qty"
              className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
            />

            <input
              type="number"
              min={1}
              value={templatePerDevices}
              onChange={(e) => setTemplatePerDevices(Number(e.target.value))}
              placeholder="Per devices"
              className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
            />

            <button
              onClick={saveTemplate}
              disabled={loading || !templateAccessoryId}
              className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
            >
              Save Rule
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Example: Qty 1 / Per devices 5 = 1 accessory for every 5 devices.
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left p-3">Accessory</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Per devices</th>
                </tr>
              </thead>

              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-slate-800">
                    <td className="p-3">{t.accessories?.name || "-"}</td>
                    <td className="p-3 text-right">{t.quantity}</td>
                    <td className="p-3 text-right">{t.per_devices}</td>
                  </tr>
                ))}

                {templates.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-center text-slate-500">
                      No template rules yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACCESSORY BINS */}
      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Accessory Bins</div>

        <div className="flex gap-2 items-center">
          <input
            value={newAccessoryBin}
            onChange={(e) => setNewAccessoryBin(e.target.value)}
            placeholder="New accessory bin..."
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-64"
          />

          <button
            onClick={addAccessoryBin}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
          >
            Add
          </button>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left p-3">Name</th>
              </tr>
            </thead>

            <tbody>
              {accessoryBins.map((bin) => (
                <tr key={bin.id} className="border-t border-slate-800">
                  <td className="p-3">{bin.name}</td>
                </tr>
              ))}

              {accessoryBins.length === 0 && (
                <tr>
                  <td className="p-4 text-center text-slate-500">
                    No accessory bins yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD ACCESSORY */}
      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Add Accessory</div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={accessoryName}
            onChange={(e) => setAccessoryName(e.target.value)}
            placeholder="Accessory name..."
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <select
            value={accessoryBinId}
            onChange={(e) => setAccessoryBinId(e.target.value)}
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          >
            <option value="">No bin</option>
            {accessoryBins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.name}
              </option>
            ))}
          </select>

          <input
            type="number"
            value={stock}
            onChange={(e) => setStock(Number(e.target.value))}
            placeholder="Stock"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <input
            type="number"
            value={minStock}
            onChange={(e) => setMinStock(Number(e.target.value))}
            placeholder="Min stock"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <button
            onClick={addAccessory}
            disabled={loading || !accessoryName.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
          >
            Add Accessory
          </button>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left p-3">Accessory</th>
                <th className="text-left p-3">Bin</th>
                <th className="text-right p-3">Stock</th>
                <th className="text-right p-3">Min stock</th>
              </tr>
            </thead>

            <tbody>
              {accessories.map((a) => (
                <tr key={a.id} className="border-t border-slate-800">
                  <td className="p-3">{a.name}</td>
                  <td className="p-3">{a.accessory_bins?.name || "-"}</td>
                  <td className="p-3 text-right">{a.current_stock}</td>
                  <td className="p-3 text-right">{a.minimum_stock}</td>
                </tr>
              ))}

              {accessories.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-slate-500">
                    No accessories yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}