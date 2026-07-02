"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

function statusOf(stock: number, min: number) {
  if (stock <= 0) return "EMPTY";
  if (min > 0 && stock <= min) return "LOW";
  return "OK";
}

export default function AccessoriesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState<string | null>(null);

  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  const [name, setName] = useState("");
  const [stock, setStock] = useState(0);
  const [minStock, setMinStock] = useState(0);

  const [adjustId, setAdjustId] = useState("");
  const [movementType, setMovementType] = useState("IN");
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  async function loadAccessories() {
    const res = await fetch(`/api/accessories/list?t=${Date.now()}`, {
      cache: "no-store",
    });

    const json = await res.json();

    if (json.ok) setRows(json.rows || []);
    else setErrorMsg(json.error || "Load failed");
  }

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      if (user?.email) setActor(user.email);
      if (user?.id) setActorId(user.id);
    }

    loadUser();
    loadAccessories();
  }, [supabase]);

  async function createAccessory() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await fetch("/api/accessories/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stock, minimum_stock: minStock }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Create failed");
      return;
    }

    setName("");
    setStock(0);
    setMinStock(0);
    setSuccessMsg("Accessory created");
    await loadAccessories();
  }

  async function adjustStock() {
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await fetch("/api/accessories/adjust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessory_id: adjustId,
        qty,
        movement_type: movementType,
        actor,
        actor_id: actorId,
        note,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setErrorMsg(json.error || "Adjust failed");
      return;
    }

    setAdjustId("");
    setQty(1);
    setNote("");
    setSuccessMsg("Stock updated");
    await loadAccessories();
  }

  const filtered = rows.filter((r) =>
    r.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-10 max-w-6xl">
      <div>
        <div className="text-xs text-slate-500">Inventory</div>
        <h2 className="text-xl font-semibold">Accessories</h2>
        <p className="text-sm text-slate-400 mt-1">
          Manage accessories stock without IMEI or serial number.
        </p>
      </div>

      {errorMsg && (
        <div className="bg-red-600/20 border border-red-500 text-red-300 px-4 py-3 rounded-xl text-sm">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-600/20 border border-emerald-500 text-emerald-300 px-4 py-3 rounded-xl text-sm">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Total accessories</div>
          <div className="text-3xl font-bold text-cyan-400">{rows.length}</div>
        </div>

        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Total stock qty</div>
          <div className="text-3xl font-bold text-purple-400">
            {rows.reduce((a, b) => a + Number(b.current_stock || 0), 0)}
          </div>
        </div>

        <div className="card-glow p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Low / Empty</div>
          <div className="text-3xl font-bold text-orange-400">
            {
              rows.filter(
                (r) =>
                  statusOf(Number(r.current_stock || 0), Number(r.minimum_stock || 0)) !==
                  "OK"
              ).length
            }
          </div>
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">New Accessory</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            placeholder="Accessory name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <input
            type="number"
            placeholder="Current stock"
            value={stock}
            onChange={(e) => setStock(Number(e.target.value))}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <input
            type="number"
            placeholder="Minimum stock"
            value={minStock}
            onChange={(e) => setMinStock(Number(e.target.value))}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <button
            onClick={createAccessory}
            disabled={busy || !name}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-40"
          >
            Add Accessory
          </button>
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="font-semibold">Adjust Stock</div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <select
            value={adjustId}
            onChange={(e) => setAdjustId(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="">Select accessory</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>

          <select
            value={movementType}
            onChange={(e) => setMovementType(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
            <option value="ADJUSTMENT">ADJUSTMENT</option>
          </select>

          <input
            type="number"
            value={qty}
            min={0}
            onChange={(e) => setQty(Number(e.target.value))}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <input
            placeholder="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <button
            onClick={adjustStock}
            disabled={busy || !adjustId}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-40"
          >
            Update Stock
          </button>
        </div>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="font-semibold">Accessories Stock</div>

          <input
            placeholder="Search accessory..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>

        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Accessory</th>
                <th className="p-2 text-right">Stock</th>
                <th className="p-2 text-right">Minimum</th>
                <th className="p-2 text-right">Status</th>
              </tr>
            </thead>

            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-slate-500">
                    No accessories yet.
                  </td>
                </tr>
              )}

              {filtered.map((r) => {
                const stock = Number(r.current_stock || 0);
                const min = Number(r.minimum_stock || 0);
                const status = statusOf(stock, min);

                return (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="p-2 font-semibold">{r.name}</td>
                    <td className="p-2 text-right">{stock}</td>
                    <td className="p-2 text-right">{min}</td>
                    <td className="p-2 text-right">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          status === "OK"
                            ? "bg-green-500/20 text-green-400"
                            : status === "LOW"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}