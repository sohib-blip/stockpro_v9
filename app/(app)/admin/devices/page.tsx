"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type DeviceRow = { device: string; min_stock: number };

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

export default function AdminDevicesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [newDevice, setNewDevice] = useState("");
  const [newMin, setNewMin] = useState("0");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/admin/devices", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeJson(res);
      if (!json.ok) throw new Error(json.error);

      setRows((json.devices || []) as DeviceRow[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addDevice() {
    const d = newDevice.trim();
    const min = Math.max(0, Number(newMin || 0));

    if (!d) {
      toast({ kind: "error", title: "Missing device name" });
      return;
    }

    const token = await getToken();
    if (!token) return;

    const res = await fetch("/api/admin/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device: d, min_stock: min }),
    });

    const json = await safeJson(res);
    if (!json.ok) {
      toast({ kind: "error", title: "Add failed", message: json.error });
      return;
    }

    setNewDevice("");
    setNewMin("0");
    toast({ kind: "success", title: "Device added" });
    await load();
  }

  async function updateMin(device: string, min_stock: number) {
    const token = await getToken();
    if (!token) return;

    const res = await fetch("/api/admin/devices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device, min_stock }),
    });

    const json = await safeJson(res);
    if (!json.ok) {
      toast({ kind: "error", title: "Update failed", message: json.error });
      return;
    }

    toast({ kind: "success", title: "Saved" });
    setRows((prev) => prev.map((r) => (r.device === device ? { ...r, min_stock } : r)));
  }

  async function removeDevice(device: string) {
    const ok = window.confirm(`Delete device "${device}" ?`);
    if (!ok) return;

    const token = await getToken();
    if (!token) return;

    const res = await fetch("/api/admin/devices", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ device }),
    });

    const json = await safeJson(res);
    if (!json.ok) {
      toast({ kind: "error", title: "Delete failed", message: json.error });
      return;
    }

    toast({ kind: "success", title: "Deleted" });
    setRows((prev) => prev.filter((r) => r.device !== device));
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Admin</div>
        <h2 className="text-xl font-semibold">Devices</h2>
        <p className="text-sm text-slate-400 mt-1">
          Add devices manually. Inbound Excel import is blocked if a device is not in this list (STRICT mode).
        </p>
      </div>

      {err && (
        <div className="border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">Add a device</div>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            value={newDevice}
            onChange={(e) => setNewDevice(e.target.value)}
            placeholder="Device name (ex: FMC234WC3XWU)"
            className="flex-1 border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
          <input
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            placeholder="Min stock"
            inputMode="numeric"
            className="w-full md:w-[160px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
          <button
            onClick={addDevice}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold"
          >
            Add
          </button>
        </div>
      </div>

      <div className="overflow-auto border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-950">
            <tr>
              <th className="p-2 text-left">Device</th>
              <th className="p-2 text-right">Min stock</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.device} className="border-t border-slate-800">
                <td className="p-2 font-semibold">{r.device}</td>
                <td className="p-2 text-right">
                  <input
                    defaultValue={String(r.min_stock ?? 0)}
                    onBlur={(e) => {
                      const v = Math.max(0, Number(e.target.value || 0));
                      if (v !== r.min_stock) updateMin(r.device, v);
                    }}
                    inputMode="numeric"
                    className="w-[120px] text-right border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-1.5 text-sm"
                  />
                </td>
                <td className="p-2 text-right">
                  <button
                    onClick={() => removeDevice(r.device)}
                    className="rounded-xl bg-rose-600 hover:bg-rose-700 px-3 py-1.5 text-sm font-semibold"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-slate-400" colSpan={3}>
                  No devices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        onClick={load}
        disabled={loading}
        className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
      >
        {loading ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}