"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { normalizeDeviceName } from "@/lib/device";

type DeviceRow = {
  device: string;
  min_stock: number;
};

export default function AdminDevicesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [newDevice, setNewDevice] = useState("");
  const [newMin, setNewMin] = useState("0");
  const [loading, setLoading] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function load() {
    setLoading(true);
    const token = await getToken();
    if (!token) return;

    const res = await fetch("/api/admin/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (json.ok) setDevices(json.devices);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addDevice() {
    const device = normalizeDeviceName(newDevice);
    const min_stock = Math.max(0, Number(newMin || 0));

    if (!device) {
      toast({ kind: "error", title: "Device manquant" });
      return;
    }

    const token = await getToken();
    if (!token) return;

    const res = await fetch("/api/admin/devices", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device, min_stock }),
    });

    const json = await res.json();
    if (!json.ok) {
      toast({ kind: "error", title: json.error });
      return;
    }

    setNewDevice("");
    setNewMin("0");
    toast({ kind: "success", title: "Device ajouté" });
    load();
  }

  const suggestions = devices
    .map((d) => d.device)
    .filter((d) =>
      d.includes(normalizeDeviceName(newDevice))
    )
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Devices</h1>

      <div className="border border-slate-800 rounded-xl p-4 space-y-3">
        <input
          value={newDevice}
          onChange={(e) => setNewDevice(e.target.value)}
          placeholder="Device (ex: FMC234WC3XWU)"
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
        />

        {newDevice && suggestions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setNewDevice(s)}
                className="text-xs px-2 py-1 border border-slate-700 rounded-full hover:bg-slate-800"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <input
          value={newMin}
          onChange={(e) => setNewMin(e.target.value)}
          placeholder="Min stock"
          className="w-40 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
        />

        <button
          onClick={addDevice}
          className="bg-emerald-600 px-4 py-2 rounded-xl font-semibold"
        >
          Ajouter
        </button>
      </div>

      <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
        <thead className="bg-slate-900">
          <tr>
            <th className="p-2 text-left">Device</th>
            <th className="p-2 text-right">Min stock</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.device} className="border-t border-slate-800">
              <td className="p-2">{d.device}</td>
              <td className="p-2 text-right">{d.min_stock}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && <div className="text-slate-400">Chargement…</div>}
    </div>
  );
}