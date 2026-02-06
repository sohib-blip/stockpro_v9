"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type DeviceRow = {
  device_id: string;
  canonical_name: string;
  device: string | null;
  min_stock: number | null;
  active: boolean | null;
};

function canonicalize(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

export default function AdminDevicesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [q, setQ] = useState("");

  const [newName, setNewName] = useState("");
  const [newMin, setNewMin] = useState<number>(0);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("device_id, device, canonical_name, min_stock, active")
        .order("canonical_name", { ascending: true });

      if (error) throw error;
      setRows((data as any) || []);
    } catch (e: any) {
      toast({ kind: "error", title: "Devices load failed", message: e?.message || "Error" });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return rows;
    return rows.filter((r) => {
      const disp = String(r.device ?? "").toLowerCase();
      const can = String(r.canonical_name ?? "").toLowerCase();
      return disp.includes(qq) || can.includes(qq);
    });
  }, [rows, q]);

  async function addDevice() {
    const display = newName.trim();
    if (!display) return toast({ kind: "error", title: "Missing device name" });

    const canonical_name = canonicalize(display);
    if (!canonical_name) {
      return toast({
        kind: "error",
        title: "Invalid name",
        message: "Device name must contain letters/numbers.",
      });
    }

    setLoading(true);
    try {
      const payload = {
        device: display,
        canonical_name,
        min_stock: Number.isFinite(newMin) ? Number(newMin) : 0,
        active: true,
      };

      const { error } = await supabase.from("devices").insert(payload as any);
      if (error) throw error;

      toast({ kind: "success", title: "Device added", message: `${display} (${canonical_name})` });
      setNewName("");
      setNewMin(0);
      await load();
    } catch (e: any) {
      toast({ kind: "error", title: "Add failed", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  async function saveMinStock(row: DeviceRow, min_stock: number) {
    setLoading(true);
    try {
      const { error } = await supabase
        .from("devices")
        .update({ min_stock: Number.isFinite(min_stock) ? Number(min_stock) : 0 })
        .eq("device_id", row.device_id);

      if (error) throw error;

      toast({ kind: "success", title: "Saved", message: "Min stock updated" });
      await load();
    } catch (e: any) {
      toast({ kind: "error", title: "Save failed", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Admin</div>
          <h2 className="text-xl font-semibold">Devices</h2>
          <p className="text-sm text-slate-400 mt-1">
            Add devices + set min stock. Import uses{" "}
            <span className="text-slate-200 font-semibold">canonical_name</span>.
          </p>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">Add device</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='Ex: "FMB 140"'
            className="border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />

          <input
            value={String(newMin)}
            onChange={(e) => setNewMin(Number(e.target.value || 0))}
            type="number"
            min={0}
            placeholder="Min stock"
            className="border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />

          <button
            onClick={addDevice}
            disabled={loading}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Canonical preview:{" "}
          <span className="text-slate-200 font-semibold">
            {newName.trim() ? canonicalize(newName) : "—"}
          </span>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold">All devices</div>
            <div className="text-xs text-slate-500">Search by display name or canonical.</div>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full md:w-[280px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="text-left p-2 border-b border-slate-800">Display</th>
                <th className="text-left p-2 border-b border-slate-800">Canonical</th>
                <th className="text-right p-2 border-b border-slate-800">Min stock</th>
                <th className="text-right p-2 border-b border-slate-800">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <DeviceRowItem key={r.device_id} row={r} onSave={saveMinStock} loading={loading} />
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="p-3 text-sm text-slate-400" colSpan={4}>
                    No devices.
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

function DeviceRowItem({
  row,
  onSave,
  loading,
}: {
  row: DeviceRow;
  onSave: (row: DeviceRow, min: number) => Promise<void>;
  loading: boolean;
}) {
  const [val, setVal] = useState<number>(Number(row.min_stock ?? 0));

  useEffect(() => {
    setVal(Number(row.min_stock ?? 0));
  }, [row.min_stock]);

  return (
    <tr className="hover:bg-slate-950/50">
      <td className="p-2 border-b border-slate-800">
        <div className="text-slate-100 font-semibold">{row.device || "—"}</div>
      </td>
      <td className="p-2 border-b border-slate-800">
        <div className="text-slate-200">{row.canonical_name}</div>
      </td>
      <td className="p-2 border-b border-slate-800 text-right">
        <input
          type="number"
          min={0}
          value={String(val)}
          onChange={(e) => setVal(Number(e.target.value || 0))}
          className="w-[120px] text-right border border-slate-800 bg-slate-950 text-slate-100 rounded-lg px-2 py-1"
        />
      </td>
      <td className="p-2 border-b border-slate-800 text-right">
        <button
          disabled={loading}
          onClick={() => onSave(row, Number.isFinite(val) ? Number(val) : 0)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          Save
        </button>
      </td>
    </tr>
  );
}