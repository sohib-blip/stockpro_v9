"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Bin = {
  id: string;
  name: string;
  active?: boolean;
  current_stock?: number;
  minimum_stock?: number;
};

export default function BinsPage() {
  const supabase = createSupabaseBrowserClient();

  const [bins, setBins] = useState<Bin[]>([]);
  const [accessoryBins, setAccessoryBins] = useState<Bin[]>([]);

  const [newBin, setNewBin] = useState("");
  const [newAccessoryBin, setNewAccessoryBin] = useState("");
  const [newAccessoryStock, setNewAccessoryStock] = useState(0);
  const [newAccessoryMinStock, setNewAccessoryMinStock] = useState(0);

  const [selectedDevice, setSelectedDevice] = useState<Bin | null>(null);
  const [templateAccessories, setTemplateAccessories] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateAccessoryId, setTemplateAccessoryId] = useState("");
  const [templateQty, setTemplateQty] = useState(1);
  const [templatePerDevices, setTemplatePerDevices] = useState(1);

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateAccessoryId, setEditTemplateAccessoryId] = useState("");
  const [editTemplateQty, setEditTemplateQty] = useState(1);
  const [editTemplatePerDevices, setEditTemplatePerDevices] = useState(1);

  const [accessoryFilter, setAccessoryFilter] =
    useState<"all" | "show" | "hide">("all");

  const [editingAccessoryId, setEditingAccessoryId] = useState<string | null>(null);
  const [editAccessoryName, setEditAccessoryName] = useState("");
  const [editAccessoryStock, setEditAccessoryStock] = useState(0);
  const [editAccessoryMinStock, setEditAccessoryMinStock] = useState(0);

  const [loading, setLoading] = useState(false);

  async function loadBins() {
    const { data } = await supabase
      .from("bins")
      .select("*")
      .order("created_at", { ascending: false });

    setBins(data || []);
  }

  async function loadAccessoryBins() {
    const res = await fetch(
      `/api/accessory-bins/list?include_hidden=1&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();
    if (json.ok) setAccessoryBins(json.rows || []);
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
      body: JSON.stringify({
        name: newAccessoryBin,
        current_stock: newAccessoryStock,
        minimum_stock: newAccessoryMinStock,
      }),
    });

    setNewAccessoryBin("");
    setNewAccessoryStock(0);
    setNewAccessoryMinStock(0);
    setLoading(false);
    loadAccessoryBins();
  }

  async function deleteBin(id: string) {
    await supabase.from("bins").delete().eq("id", id);
    loadBins();
  }

  async function toggleAccessoryVisibility(id: string, active: boolean) {
    setLoading(true);

    await fetch("/api/accessory-bins/toggle-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });

    setLoading(false);
    loadAccessoryBins();
  }

  function startEditAccessory(bin: Bin) {
    setEditingAccessoryId(bin.id);
    setEditAccessoryName(bin.name);
    setEditAccessoryStock(Number(bin.current_stock || 0));
    setEditAccessoryMinStock(Number(bin.minimum_stock || 0));
  }

  function cancelEditAccessory() {
    setEditingAccessoryId(null);
    setEditAccessoryName("");
    setEditAccessoryStock(0);
    setEditAccessoryMinStock(0);
  }

  async function saveAccessoryEdit(id: string) {
    setLoading(true);

    await fetch("/api/accessory-bins/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: editAccessoryName,
        current_stock: editAccessoryStock,
        minimum_stock: editAccessoryMinStock,
      }),
    });

    setLoading(false);
    cancelEditAccessory();
    loadAccessoryBins();
  }

  async function deleteAccessory(id: string) {
    const ok = confirm("Are you sure you want to delete this accessory?");
    if (!ok) return;

    setLoading(true);

    await fetch("/api/accessory-bins/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    setLoading(false);
    loadAccessoryBins();
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

    const res = await fetch("/api/bins/templates/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: selectedDevice.id,
        accessory_bin_id: templateAccessoryId,
        quantity: templateQty,
        per_devices: templatePerDevices,
      }),
    });

    const json = await res.json();
    setLoading(false);

    if (!json.ok) {
      alert(json.error || "Save template failed");
      return;
    }

    setTemplateAccessoryId("");
    setTemplateQty(1);
    setTemplatePerDevices(1);

    await openTemplate(selectedDevice);
  }

  function startEditTemplate(t: any) {
    setEditingTemplateId(t.id);
    setEditTemplateAccessoryId(t.accessory_bin_id);
    setEditTemplateQty(Number(t.quantity || 1));
    setEditTemplatePerDevices(Number(t.per_devices || 1));
  }

  function cancelEditTemplate() {
    setEditingTemplateId(null);
    setEditTemplateAccessoryId("");
    setEditTemplateQty(1);
    setEditTemplatePerDevices(1);
  }

  async function saveTemplateEdit() {
    if (!selectedDevice || !editTemplateAccessoryId) return;

    setLoading(true);

    const res = await fetch("/api/bins/templates/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: selectedDevice.id,
        accessory_bin_id: editTemplateAccessoryId,
        quantity: editTemplateQty,
        per_devices: editTemplatePerDevices,
      }),
    });

    const json = await res.json();
    setLoading(false);

    if (!json.ok) {
      alert(json.error || "Update template failed");
      return;
    }

    cancelEditTemplate();
    await openTemplate(selectedDevice);
  }

  async function deleteTemplate(id: string) {
    if (!selectedDevice) return;

    const ok = confirm("Delete this template rule?");
    if (!ok) return;

    setLoading(true);

    const res = await fetch("/api/bins/templates/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const json = await res.json();
    setLoading(false);

    if (!json.ok) {
      alert(json.error || "Delete template failed");
      return;
    }

    await openTemplate(selectedDevice);
  }

  useEffect(() => {
    loadBins();
    loadAccessoryBins();
  }, []);

  const filteredAccessoryBins = accessoryBins.filter((bin) => {
    if (accessoryFilter === "show") return bin.active !== false;
    if (accessoryFilter === "hide") return bin.active === false;
    return true;
  });

  return (
    <div className="space-y-10 max-w-6xl">
      <h1 className="text-xl font-semibold">Bins</h1>

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

      {selectedDevice && (
        <div className="card-glow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Template for {selectedDevice.name}</div>

            <button
              onClick={() => setSelectedDevice(null)}
              className="text-sm border border-slate-800 px-3 py-1 rounded-lg hover:bg-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Accessory</label>

              <select
                value={templateAccessoryId}
                onChange={(e) => setTemplateAccessoryId(e.target.value)}
                className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-full"
              >
                <option value="">Select accessory...</option>
                {templateAccessories.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Quantity to include</label>

              <input
                type="number"
                min={1}
                value={templateQty}
                onChange={(e) => setTemplateQty(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-full"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">For every X devices</label>

              <input
                type="number"
                min={1}
                value={templatePerDevices}
                onChange={(e) => setTemplatePerDevices(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-full"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-transparent">Action</label>

              <button
                onClick={saveTemplate}
                disabled={loading || !templateAccessoryId}
                className="w-full bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              >
                Save Rule
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Example: If an order contains <b>25 devices</b> and the rule is{" "}
            <b>1 every 5 devices</b>, StockPro will automatically remove{" "}
            <b>5 accessories</b>.
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left p-3">Accessory</th>
                  <th className="text-right p-3">Qty</th>
                  <th className="text-right p-3">Per devices</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {templates.map((t) => {
                  const isEditingTemplate = editingTemplateId === t.id;

                  return (
                    <tr key={t.id} className="border-t border-slate-800">
                      <td className="p-3">
                        {isEditingTemplate ? (
                          <select
                            value={editTemplateAccessoryId}
                            onChange={(e) =>
                              setEditTemplateAccessoryId(e.target.value)
                            }
                            className="bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm w-full"
                          >
                            {templateAccessories.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          t.accessory_bins?.name || "-"
                        )}
                      </td>

                      <td className="p-3 text-right">
                        {isEditingTemplate ? (
                          <input
                            type="number"
                            min={1}
                            value={editTemplateQty}
                            onChange={(e) =>
                              setEditTemplateQty(Number(e.target.value))
                            }
                            className="w-20 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm text-right"
                          />
                        ) : (
                          t.quantity
                        )}
                      </td>

                      <td className="p-3 text-right">
                        {isEditingTemplate ? (
                          <input
                            type="number"
                            min={1}
                            value={editTemplatePerDevices}
                            onChange={(e) =>
                              setEditTemplatePerDevices(Number(e.target.value))
                            }
                            className="w-20 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm text-right"
                          />
                        ) : (
                          t.per_devices
                        )}
                      </td>

                      <td className="p-3 text-right space-x-3">
                        {isEditingTemplate ? (
                          <>
                            <button
                              onClick={saveTemplateEdit}
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              Save
                            </button>

                            <button
                              onClick={cancelEditTemplate}
                              className="text-slate-400 hover:text-slate-300"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditTemplate(t)}
                              className="text-cyan-400 hover:text-cyan-300"
                            >
                              Edit
                            </button>

                            <button
                              onClick={() => deleteTemplate(t.id)}
                              className="text-rose-400 hover:text-rose-500"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {templates.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-slate-500">
                      No template rules yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card-glow p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">Accessories</div>
            <div className="text-xs text-slate-500 mt-1">
              Create accessories, define stock levels and choose if they are
              visible in outbound/dashboard.
            </div>
          </div>

          <div className="flex gap-2">
            {(["all", "show", "hide"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setAccessoryFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                  accessoryFilter === f
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={newAccessoryBin}
            onChange={(e) => setNewAccessoryBin(e.target.value)}
            placeholder="Accessory name (QR Guide, Wipe...)"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <input
            type="number"
            value={newAccessoryStock}
            onChange={(e) => setNewAccessoryStock(Number(e.target.value))}
            placeholder="Initial stock"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <input
            type="number"
            value={newAccessoryMinStock}
            onChange={(e) => setNewAccessoryMinStock(Number(e.target.value))}
            placeholder="Minimum stock alert"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
          />

          <button
            onClick={addAccessoryBin}
            disabled={loading || !newAccessoryBin.trim()}
            className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
          >
            Create Accessory
          </button>
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900">
              <tr>
                <th className="text-left p-3">Accessory</th>
                <th className="text-right p-3">Stock</th>
                <th className="text-right p-3">Min stock</th>
                <th className="text-right p-3">Visibility</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filteredAccessoryBins.map((bin) => {
                const isActive = bin.active !== false;
                const isEditing = editingAccessoryId === bin.id;

                return (
                  <tr key={bin.id} className="border-t border-slate-800">
                    <td className="p-3">
                      {isEditing ? (
                        <input
                          value={editAccessoryName}
                          onChange={(e) =>
                            setEditAccessoryName(e.target.value)
                          }
                          className="w-full bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm"
                        />
                      ) : (
                        bin.name
                      )}
                    </td>

                    <td className="p-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editAccessoryStock}
                          onChange={(e) =>
                            setEditAccessoryStock(Number(e.target.value))
                          }
                          className="w-24 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm text-right"
                        />
                      ) : (
                        Number(bin.current_stock || 0)
                      )}
                    </td>

                    <td className="p-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editAccessoryMinStock}
                          onChange={(e) =>
                            setEditAccessoryMinStock(Number(e.target.value))
                          }
                          className="w-24 bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm text-right"
                        />
                      ) : (
                        Number(bin.minimum_stock || 0)
                      )}
                    </td>

                    <td className="p-3 text-right">
                      <button
                        onClick={() =>
                          toggleAccessoryVisibility(bin.id, !isActive)
                        }
                        disabled={isEditing}
                        className={`px-3 py-1 rounded text-xs font-semibold disabled:opacity-40 ${
                          isActive
                            ? "bg-green-500/20 text-green-400"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {isActive ? "SHOW" : "HIDE"}
                      </button>
                    </td>

                    <td className="p-3 text-right space-x-3">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveAccessoryEdit(bin.id)}
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            Save
                          </button>

                          <button
                            onClick={cancelEditAccessory}
                            className="text-slate-400 hover:text-slate-300"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditAccessory(bin)}
                            className="text-cyan-400 hover:text-cyan-300"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => deleteAccessory(bin.id)}
                            className="text-rose-400 hover:text-rose-500"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredAccessoryBins.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500">
                    No accessories found.
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