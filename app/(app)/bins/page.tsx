"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiFetch";
import ProcessFeedback, { type ProcessFeedbackValue } from "@/components/ProcessFeedback";
import ConfirmDialog from "@/components/ConfirmDialog";
import PackagingInventoryPanel from "@/components/PackagingInventoryPanel";

type AccessoryCategory =
  | "Consumables"
  | "Harness"
  | "Vision"
  | "Items";

type Bin = {
  id: string;
  name: string;
  active?: boolean;
  current_stock?: number;
  minimum_stock?: number;
  category?: AccessoryCategory;
};

export default function BinsPage() {
  const supabase = createSupabaseBrowserClient();

  const [bins, setBins] = useState<Bin[]>([]);
  const [accessoryBins, setAccessoryBins] = useState<Bin[]>([]);
  const [packagingCount, setPackagingCount] = useState(0);

  const [newBin, setNewBin] = useState("");
  const [newAccessoryBin, setNewAccessoryBin] = useState("");
  const [newAccessoryStock, setNewAccessoryStock] = useState(0);
  const [newAccessoryMinStock, setNewAccessoryMinStock] = useState(0);
  const [newAccessoryCategory, setNewAccessoryCategory] =
  useState<AccessoryCategory>("Consumables");

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
  const [editAccessoryCategory, setEditAccessoryCategory] =
  useState<AccessoryCategory>("Consumables");

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<ProcessFeedbackValue | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "device-bin" | "accessory" | "rule";
    id: string;
    name: string;
  } | null>(null);
  const [activeSetupTab, setActiveSetupTab] = useState<
    "bins" | "rules" | "accessories" | "packaging"
  >("bins");

  function showSetupError(message: string) {
    setFeedback({ kind: "error", title: "Inventory setup action failed", message });
  }

  function showSetupSuccess(message: string) {
    setFeedback({ kind: "success", title: "Inventory setup updated", message });
  }

  async function loadBins() {
    const { data } = await supabase
      .from("bins")
      .select("*")
      .order("created_at", { ascending: false });

    setBins(data || []);
  }

  async function loadAccessoryBins() {
    const res = await apiFetch(
      `/api/accessory-bins/list?include_hidden=1&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();
    if (json.ok) setAccessoryBins(json.rows || []);
  }

  async function loadPackagingCount() {
    const response = await apiFetch(
      `/api/packaging/list?include_hidden=1&t=${Date.now()}`,
      { cache: "no-store" }
    );
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) setPackagingCount((json.rows || []).length);
  }

  async function addBin() {
    if (!newBin.trim()) return;

    setLoading(true);
    setFeedback(null);
    const binName = newBin.trim();
    const { error } = await supabase.from("bins").insert({ name: binName });

    if (error) {
      setLoading(false);
      showSetupError(error.message || "Device bin creation failed");
      return;
    }

    setNewBin("");
    setLoading(false);
    await loadBins();
    showSetupSuccess(`Device bin ${binName} created successfully.`);
  }

  async function addAccessoryBin() {
    if (!newAccessoryBin.trim()) return;

    setLoading(true);

    setFeedback(null);
    const accessoryName = newAccessoryBin.trim();
    const response = await apiFetch("/api/accessory-bins/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newAccessoryBin,
        current_stock: newAccessoryStock,
        minimum_stock: newAccessoryMinStock,
        category: newAccessoryCategory,
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setLoading(false);
      showSetupError(json?.error || "Accessory creation failed");
      return;
    }

    setNewAccessoryBin("");
    setNewAccessoryStock(0);
    setNewAccessoryMinStock(0);
    setNewAccessoryCategory("Consumables");

    setLoading(false);
    await loadAccessoryBins();
    showSetupSuccess(`Accessory ${accessoryName} created successfully.`);
  }

  async function deleteBin(id: string) {
    setFeedback(null);
    const binName = bins.find((bin) => bin.id === id)?.name || "Device bin";
    const { error } = await supabase.from("bins").delete().eq("id", id);
    if (error) {
      showSetupError(error.message || "Device bin deletion failed");
      return;
    }
    await loadBins();
    showSetupSuccess(`${binName} deleted successfully.`);
  }

  async function toggleAccessoryVisibility(id: string, active: boolean) {
    setLoading(true);

    setFeedback(null);
    const response = await apiFetch("/api/accessory-bins/toggle-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setLoading(false);
      showSetupError(json?.error || "Accessory visibility update failed");
      return;
    }

    setLoading(false);
    await loadAccessoryBins();
    showSetupSuccess(`Accessory ${active ? "shown" : "hidden"} successfully.`);
  }

  function startEditAccessory(bin: Bin) {
    setEditingAccessoryId(bin.id);
    setEditAccessoryName(bin.name);
    setEditAccessoryStock(Number(bin.current_stock || 0));
    setEditAccessoryMinStock(Number(bin.minimum_stock || 0));
    setEditAccessoryCategory(bin.category || "Consumables");
  }

  function cancelEditAccessory() {
    setEditingAccessoryId(null);
    setEditAccessoryName("");
    setEditAccessoryStock(0);
    setEditAccessoryMinStock(0);
    setEditAccessoryCategory("Consumables");
  }

  async function saveAccessoryEdit(id: string) {
    setLoading(true);

    setFeedback(null);
    const response = await apiFetch("/api/accessory-bins/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: editAccessoryName,
        current_stock: editAccessoryStock,
        minimum_stock: editAccessoryMinStock,
        category: editAccessoryCategory,
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setLoading(false);
      showSetupError(json?.error || "Accessory update failed");
      return;
    }

    setLoading(false);
    cancelEditAccessory();
    await loadAccessoryBins();
    showSetupSuccess(`${editAccessoryName.trim() || "Accessory"} updated successfully.`);
  }

  async function deleteAccessory(id: string) {
    setLoading(true);

    setFeedback(null);
    const accessoryName = accessoryBins.find((bin) => bin.id === id)?.name || "Accessory";
    const response = await apiFetch("/api/accessory-bins/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.ok) {
      setLoading(false);
      showSetupError(json?.error || "Accessory deletion failed");
      return;
    }

    setLoading(false);
    await loadAccessoryBins();
    showSetupSuccess(`${accessoryName} deleted successfully.`);
  }

  async function openTemplate(bin: Bin) {
    setSelectedDevice(bin);
    setActiveSetupTab("rules");

    const res = await apiFetch(
      `/api/bins/templates/list?device_id=${bin.id}&t=${Date.now()}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json.ok) {
      setTemplateAccessories(json.accessories || []);
      setTemplates(json.templates || []);
    } else {
      showSetupError(json.error || "Automatic accessory rules could not be loaded");
    }
  }

  async function saveTemplate() {
    if (!selectedDevice || !templateAccessoryId) return;

    setLoading(true);

    const res = await apiFetch("/api/bins/templates/save", {
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
      showSetupError(json.error || "Save template failed");
      return;
    }

    setTemplateAccessoryId("");
    setTemplateQty(1);
    setTemplatePerDevices(1);

    await openTemplate(selectedDevice);
    showSetupSuccess("Automatic accessory rule created successfully.");
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

    const res = await apiFetch("/api/bins/templates/save", {
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
      showSetupError(json.error || "Update template failed");
      return;
    }

    cancelEditTemplate();
    await openTemplate(selectedDevice);
    showSetupSuccess("Automatic accessory rule updated successfully.");
  }

  async function deleteTemplate(id: string) {
    if (!selectedDevice) return;

    setLoading(true);

    const res = await apiFetch("/api/bins/templates/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    const json = await res.json();
    setLoading(false);

    if (!json.ok) {
      showSetupError(json.error || "Delete template failed");
      return;
    }

    await openTemplate(selectedDevice);
    showSetupSuccess("Automatic accessory rule deleted successfully.");
  }

  useEffect(() => {
    loadBins();
    loadAccessoryBins();
    loadPackagingCount();
  }, []);

  const filteredAccessoryBins = accessoryBins.filter((bin) => {
    if (accessoryFilter === "show") return bin.active !== false;
    if (accessoryFilter === "hide") return bin.active === false;
    return true;
  });

  return (
    <div className="prototype-page prototype-module-page bins-prototype-page">
      <div className="prototype-page-header">
        <div>
        <h1>Inventory Setup</h1>
        <p>
          Configure device bins, automatic accessory rules, accessories and packaging stock.
        </p>
        </div>
      </div>

      {feedback && (
        <ProcessFeedback
          {...feedback}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="prototype-section-tabs" role="tablist" aria-label="Inventory setup sections">
        <button type="button" role="tab" aria-selected={activeSetupTab === "bins"} className={activeSetupTab === "bins" ? "is-active" : ""} onClick={() => setActiveSetupTab("bins")}>Device Bins <span>{bins.length}</span></button>
        <button type="button" role="tab" aria-selected={activeSetupTab === "rules"} className={activeSetupTab === "rules" ? "is-active" : ""} onClick={() => { setActiveSetupTab("rules"); if (!selectedDevice && bins[0]) openTemplate(bins[0]); }}>Automatic Accessory Rules <span>{templates.length}</span></button>
        <button type="button" role="tab" aria-selected={activeSetupTab === "accessories"} className={activeSetupTab === "accessories" ? "is-active" : ""} onClick={() => setActiveSetupTab("accessories")}>Accessory Inventory <span>{accessoryBins.length}</span></button>
        <button type="button" role="tab" aria-selected={activeSetupTab === "packaging"} className={activeSetupTab === "packaging" ? "is-active" : ""} onClick={() => setActiveSetupTab("packaging")}>Packaging Inventory <span>{packagingCount}</span></button>
      </div>

      {activeSetupTab === "bins" && (
      <div className="prototype-card prototype-history-card space-y-4">
        <div className="font-semibold">Device Bins</div>

        <div className="inventory-bin-create">
          <input
            value={newBin}
            onChange={(e) => setNewBin(e.target.value)}
            placeholder="New device bin"
            className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm w-64"
          />

          <button
            onClick={addBin}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
          >
            Add Bin
          </button>
        </div>

        <div className="inventory-bins-table-scroll border border-slate-800 rounded-xl">
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
                      Accessory Rules
                    </button>

                    <button
                      onClick={() => setDeleteTarget({ kind: "device-bin", id: bin.id, name: bin.name })}
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
                    No device bins have been configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeSetupTab === "rules" && selectedDevice && (
        <div className="prototype-rules-layout">
        <aside className="prototype-rule-sidebar">
          <div>Rules by device bin</div>
          {bins.map((bin) => (
            <button type="button" key={bin.id} className={selectedDevice.id === bin.id ? "is-active" : ""} onClick={() => openTemplate(bin)}><span>{bin.name}</span><small>{selectedDevice.id === bin.id ? templates.length : ""} rules</small></button>
          ))}
        </aside>
        <div className="prototype-card prototype-history-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Automatic Accessory Rules for {selectedDevice.name}</div>

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
                <option value="">Select an accessory</option>
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
              <label className="text-xs text-slate-400">Devices per allocation</label>

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
                className="w-full bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
              >
                Save Rule
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            Example: If an order contains <b>25 devices</b> and the rule is{" "}
            <b>1 accessory per 5 devices</b>, StockPro will automatically remove{" "}
            <b>5 accessories</b>.
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left p-3">Accessory</th>
                  <th className="text-right p-3">Quantity</th>
                  <th className="text-right p-3">Device Interval</th>
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
                              onClick={() => setDeleteTarget({ kind: "rule", id: t.id, name: t.accessory_bins?.name || "this automatic rule" })}
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
                      No automatic accessory rules have been configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {activeSetupTab === "accessories" && (
      <div className="prototype-card prototype-history-card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-lg">Accessory Inventory</div>
            <div className="text-xs text-slate-500 mt-1">
              Create accessories, define stock levels and choose if they are
              available in outbound processing and on the dashboard.
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
                {f === "all" ? "All" : f === "show" ? "Visible" : "Hidden"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={newAccessoryBin}
            onChange={(e) => setNewAccessoryBin(e.target.value)}
            placeholder="Accessory name, e.g. QR Guide"
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

          <select
  value={newAccessoryCategory}
  onChange={(e) =>
    setNewAccessoryCategory(e.target.value as AccessoryCategory)
  }
  className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-sm"
>
  <option value="Consumables">Consumables</option>
  <option value="Harness">Harness</option>
  <option value="Vision">Vision</option>
  <option value="Items">Items</option>
</select>

          <button
            onClick={addAccessoryBin}
            disabled={loading || !newAccessoryBin.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
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
    <th className="text-right p-3">Minimum Stock</th>
    <th className="text-left p-3">Category</th>
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

                    <td className="p-3">
  {isEditing ? (
    <select
      value={editAccessoryCategory}
      onChange={(e) =>
        setEditAccessoryCategory(e.target.value as AccessoryCategory)
      }
      className="bg-slate-950 border border-slate-800 px-2 py-1 rounded-lg text-sm"
    >
      <option value="Consumables">Consumables</option>
      <option value="Harness">Harness</option>
      <option value="Vision">Vision</option>
      <option value="Items">Items</option>
    </select>
  ) : (
    bin.category || "Consumables"
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
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {isActive ? "Visible" : "Hidden"}
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
                            onClick={() => setDeleteTarget({ kind: "accessory", id: bin.id, name: bin.name })}
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
                  <td colSpan={6} className="p-4 text-center text-slate-500">
                    No accessories found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeSetupTab === "packaging" && (
        <PackagingInventoryPanel
          onCountChange={setPackagingCount}
          onFeedback={setFeedback}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete inventory setup item?"
        message={
          deleteTarget
            ? `Delete ${deleteTarget.name}? This action cannot be undone.`
            : undefined
        }
        confirmText={loading ? "Deleting…" : "Delete"}
        cancelText="Cancel"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target || loading) return;
          setDeleteTarget(null);
          if (target.kind === "device-bin") void deleteBin(target.id);
          else if (target.kind === "accessory") void deleteAccessory(target.id);
          else void deleteTemplate(target.id);
        }}
      />
    </div>
  );
}
