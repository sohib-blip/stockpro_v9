"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AccessoryCategory =
  | "Packages"
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
        category: newAccessoryCategory,
      }),
    });

    setNewAccessoryBin("");
    setNewAccessoryStock(0);
    setNewAccessoryMinStock(0);
    setNewAccessoryCategory("Consumables");

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

    await fetch("/api/accessory-bins/update", {
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
    <div className="space-y-6 w-full">
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Inventory</div>
          <h1 className="sp-title">Bins</h1>
        </div>
      </div>

      <section className="sp-card space-y-4">
        <div className="sp-tab sp-tab-active w-fit">Device Bins</div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newBin}
            onChange={(e) => setNewBin(e.target.value)}
            placeholder="New device bin..."
            className="sp-input w-full sm:w-64"
          />

          <button
            onClick={addBin}
            disabled={loading}
            className="sp-btn sp-btn-primary"
          >
            Add
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-sp-border">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>

            <tbody>
              {bins.map((bin) => (
                <tr key={bin.id}>
                  <td>{bin.name}</td>
                  <td className="text-right space-x-3">
                    <button
                      onClick={() => openTemplate(bin)}
                      className="font-semibold text-sp-primary hover:text-sp-primary-hover"
                    >
                      Template
                    </button>

                    <button
                      onClick={() => deleteBin(bin.id)}
                      className="font-semibold text-sp-err hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}

              {bins.length === 0 && (
                <tr>
                  <td colSpan={2} className="text-center text-sp-muted">
                    No device bins yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDevice && (
        <section className="sp-card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="sp-tab sp-tab-active w-fit">Automatic Accessory Rules</div>
              <div className="mt-3 font-semibold text-sp-text">
                Template for {selectedDevice.name}
              </div>
            </div>

            <button
              onClick={() => setSelectedDevice(null)}
              className="sp-btn sp-btn-ghost"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="sp-label">Accessory</label>

              <select
                value={templateAccessoryId}
                onChange={(e) => setTemplateAccessoryId(e.target.value)}
                className="sp-select"
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
              <label className="sp-label">Quantity to include</label>

              <input
                type="number"
                min={1}
                value={templateQty}
                onChange={(e) => setTemplateQty(Number(e.target.value))}
                className="sp-input"
              />
            </div>

            <div className="space-y-1">
              <label className="sp-label">For every X devices</label>

              <input
                type="number"
                min={1}
                value={templatePerDevices}
                onChange={(e) => setTemplatePerDevices(Number(e.target.value))}
                className="sp-input"
              />
            </div>

            <div className="space-y-1">
              <label className="sp-label text-transparent">Action</label>

              <button
                onClick={saveTemplate}
                disabled={loading || !templateAccessoryId}
                className="sp-btn sp-btn-primary w-full"
              >
                Save Rule
              </button>
            </div>
          </div>

          <div className="text-xs text-sp-muted">
            Example: If an order contains <b>25 devices</b> and the rule is{" "}
            <b>1 every 5 devices</b>, StockPro will automatically remove{" "}
            <b>5 accessories</b>.
          </div>

          <div className="overflow-x-auto rounded-lg border border-sp-border">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Accessory</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Per devices</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>

              <tbody>
                {templates.map((t) => {
                  const isEditingTemplate = editingTemplateId === t.id;

                  return (
                    <tr key={t.id}>
                      <td>
                        {isEditingTemplate ? (
                          <select
                            value={editTemplateAccessoryId}
                            onChange={(e) =>
                              setEditTemplateAccessoryId(e.target.value)
                            }
                            className="sp-select"
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

                      <td className="text-right">
                        {isEditingTemplate ? (
                          <input
                            type="number"
                            min={1}
                            value={editTemplateQty}
                            onChange={(e) =>
                              setEditTemplateQty(Number(e.target.value))
                            }
                            className="sp-input ml-auto w-20 text-right"
                          />
                        ) : (
                          t.quantity
                        )}
                      </td>

                      <td className="text-right">
                        {isEditingTemplate ? (
                          <input
                            type="number"
                            min={1}
                            value={editTemplatePerDevices}
                            onChange={(e) =>
                              setEditTemplatePerDevices(Number(e.target.value))
                            }
                            className="sp-input ml-auto w-20 text-right"
                          />
                        ) : (
                          t.per_devices
                        )}
                      </td>

                      <td className="text-right space-x-3">
                        {isEditingTemplate ? (
                          <>
                            <button
                              onClick={saveTemplateEdit}
                              className="font-semibold text-sp-ok hover:underline"
                            >
                              Save
                            </button>

                            <button
                              onClick={cancelEditTemplate}
                              className="font-semibold text-sp-secondary hover:text-sp-text"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditTemplate(t)}
                              className="font-semibold text-sp-primary hover:text-sp-primary-hover"
                            >
                              Edit
                            </button>

                            <button
                              onClick={() => deleteTemplate(t.id)}
                              className="font-semibold text-sp-err hover:underline"
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
                    <td colSpan={4} className="text-center text-sp-muted">
                      No template rules yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="sp-card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="sp-tab sp-tab-active w-fit">Accessory Inventory</div>
            <div className="text-xs text-sp-muted mt-3">
              Create accessories, define stock levels and choose if they are
              visible in outbound/dashboard.
            </div>
          </div>

          <div className="flex border-b border-sp-border">
            {(["all", "show", "hide"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setAccessoryFilter(f)}
                className={`sp-tab ${
                  accessoryFilter === f
                    ? "sp-tab-active"
                    : ""
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={newAccessoryBin}
            onChange={(e) => setNewAccessoryBin(e.target.value)}
            placeholder="Accessory name (QR Guide, Wipe...)"
            className="sp-input"
          />

          <input
            type="number"
            value={newAccessoryStock}
            onChange={(e) => setNewAccessoryStock(Number(e.target.value))}
            placeholder="Initial stock"
            className="sp-input"
          />

          <input
            type="number"
            value={newAccessoryMinStock}
            onChange={(e) => setNewAccessoryMinStock(Number(e.target.value))}
            placeholder="Minimum stock alert"
            className="sp-input"
          />

          <select
  value={newAccessoryCategory}
  onChange={(e) =>
    setNewAccessoryCategory(e.target.value as AccessoryCategory)
  }
  className="sp-select"
>
  <option value="Packages">Packages</option>
  <option value="Consumables">Consumables</option>
  <option value="Harness">Harness</option>
  <option value="Vision">Vision</option>
  <option value="Items">Items</option>
</select>

          <button
            onClick={addAccessoryBin}
            disabled={loading || !newAccessoryBin.trim()}
            className="sp-btn sp-btn-primary"
          >
            Create Accessory
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-sp-border">
          <table className="sp-table">
            <thead>
  <tr>
    <th>Accessory</th>
    <th className="text-right">Stock</th>
    <th className="text-right">Min stock</th>
    <th>Category</th>
    <th className="text-right">Visibility</th>
    <th className="text-right">Actions</th>
  </tr>
</thead>

            <tbody>
              {filteredAccessoryBins.map((bin) => {
                const isActive = bin.active !== false;
                const isEditing = editingAccessoryId === bin.id;

                return (
                  <tr key={bin.id}>
                    <td>
                      {isEditing ? (
                        <input
                          value={editAccessoryName}
                          onChange={(e) =>
                            setEditAccessoryName(e.target.value)
                          }
                          className="sp-input"
                        />
                      ) : (
                        bin.name
                      )}
                    </td>

                    <td className="text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editAccessoryStock}
                          onChange={(e) =>
                            setEditAccessoryStock(Number(e.target.value))
                          }
                          className="sp-input ml-auto w-24 text-right"
                        />
                      ) : (
                        Number(bin.current_stock || 0)
                      )}
                    </td>

                    <td className="text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editAccessoryMinStock}
                          onChange={(e) =>
                            setEditAccessoryMinStock(Number(e.target.value))
                          }
                          className="sp-input ml-auto w-24 text-right"
                        />
                      ) : (
                        Number(bin.minimum_stock || 0)
                      )}
                    </td>

                    <td>
  {isEditing ? (
    <select
      value={editAccessoryCategory}
      onChange={(e) =>
        setEditAccessoryCategory(e.target.value as AccessoryCategory)
      }
      className="sp-select"
    >
      <option value="Packages">Packages</option>
      <option value="Consumables">Consumables</option>
      <option value="Harness">Harness</option>
      <option value="Vision">Vision</option>
      <option value="Items">Items</option>
    </select>
  ) : (
    <span className="sp-badge sp-badge-info">
      {bin.category || "Consumables"}
    </span>
  )}
</td>

                    <td className="text-right">
                      <button
                        onClick={() =>
                          toggleAccessoryVisibility(bin.id, !isActive)
                        }
                        disabled={isEditing}
                        className={`sp-badge disabled:opacity-40 ${
                          isActive
                            ? "sp-badge-ok"
                            : "sp-badge-neutral"
                        }`}
                      >
                        {isActive ? "SHOW" : "HIDE"}
                      </button>
                    </td>

                    <td className="text-right space-x-3">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveAccessoryEdit(bin.id)}
                            className="font-semibold text-sp-ok hover:underline"
                          >
                            Save
                          </button>

                          <button
                            onClick={cancelEditAccessory}
                            className="font-semibold text-sp-secondary hover:text-sp-text"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditAccessory(bin)}
                            className="font-semibold text-sp-primary hover:text-sp-primary-hover"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => deleteAccessory(bin.id)}
                            className="font-semibold text-sp-err hover:underline"
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
                  <td colSpan={6} className="text-center text-sp-muted">
                    No accessories found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
