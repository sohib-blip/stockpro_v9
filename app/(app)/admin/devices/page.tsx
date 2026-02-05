"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type DeviceRow = {
  device: string;
  min_stock: number | null;
  created_at?: string | null;
};

export default function DevicesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [q, setQ] = useState("");

  const [newDevice, setNewDevice] = useState("");
  const [newMinStock, setNewMinStock] = useState<number>(0);

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("devices")
        .select("device, min_stock, created_at")
        .order("device", { ascending: true });

      if (error) throw error;
      setRows((data || []) as DeviceRow[]);
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

  const filtered = rows.filter((r) => String(r.device).toLowerCase().includes(q.trim().toLowerCase()));

  async function addDevice() {
    const device = newDevice.trim().toUpperCase();
    if (!device) {
      toast({ kind: "error", title: "Device name required" });
      return;
    }

    try {
      const { error } = await supabase.from("devices").upsert(
        { device, min_stock: Number(newMinStock || 0) },
        { onConflict: "device" }
      );

      if (error) throw error;

      toast({ kind: "success", title: "Device saved" });
      setNewDevice("");
      setNewMinStock(0);
      await load();
    } catch (e: any) {
      toast({ kind: "error", title: "Save failed", message: e?.message || "Error" });
    }
  }

  async function updateMinStock(device: string, min_stock: number) {
    try {
      const { error } = await supabase.from("devices").update({ min_stock }).eq("device", device);
      if (error) throw error;
      toast({ kind: "success", title: "Min stock updated" });
      setRows((prev) => prev.map((r) => (r.device === device ? { ...r, min_stock } : r)));
    } catch (e: any) {
      toast({ kind: "error", title: "Update failed", message: e?.message || "Error" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Admin</div>
          <h1 className="text-xl font-semibold">Devices</h1>
          <p className="text-sm text-slate-400 mt-1">Crée tes devices manuellement et choisis le min stock.</p>
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
        <div className="text-sm font-semibold">Add / Update device</div>
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <input
            value={newDevice}
            onChange={(e) => setNewDevice(e.target.value)}
            placeholder="Device name (ex: FMC234WC3XWU)"
            className="w-full md:w-[320px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />

          <input
            type="number"
            value={newMinStock}
            onChange={(e) => setNewMinStock(Number(e.target.value))}
            className="w-full md:w-[160px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            min={0}
          />

          <button onClick={addDevice} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold">
            Save
          </button>
        </div>

        <div className="text-xs text-slate-500">Si le device existe déjà, ça met juste à jour le min stock.</div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">All devices</div>
            <div className="text-xs text-slate-500">Min stock utilisé par le dashboard.</div>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search device…"
            className="w-full md:w-[280px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div className="overflow-auto mt-3">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left border-b border-slate-800">Device</th>
                <th className="p-2 text-right border-b border-slate-800">Min stock</th>
                <th className="p-2 text-right border-b border-slate-800">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <DeviceRowItem key={r.device} row={r} onSave={updateMinStock} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-3 text-slate-400">
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

function DeviceRowItem({ row, onSave }: { row: DeviceRow; onSave: (device: string, min: number) => Promise<void> }) {
  const [val, setVal] = useState<number>(Number(row.min_stock ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(Number(row.min_stock ?? 0));
  }, [row.min_stock]);

  async function save() {
    setSaving(true);
    try {
      await onSave(row.device, Number(val || 0));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="hover:bg-slate-950/50">
      <td className="p-2 border-b border-slate-800 font-semibold">{row.device}</td>
      <td className="p-2 border-b border-slate-800 text-right">
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          className="w-[120px] text-right bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-sm"
          min={0}
        />
      </td>
      <td className="p-2 border-b border-slate-800 text-right">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </td>
    </tr>
  );
}