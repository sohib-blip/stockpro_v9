"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type DeviceRow = {
  id?: string;
  canonical_name: string;
  device?: string | null;
  min_stock?: number | null;
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

  // ✅ DEBUG
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "MISSING_ENV";
  const [debug, setDebug] = useState<{ step: string; error?: string; count?: number }>({
    step: "idle",
  });

  async function load() {
    setLoading(true);
    setDebug({ step: "loading" });

    try {
      // 1) try with device column
      const first = await supabase
        .from("devices")
        .select("id, canonical_name, device, min_stock")
        .order("canonical_name", { ascending: true });

      if (!first.error) {
        const data = (first.data as any[]) || [];
        setRows(data);
        setDebug({ step: "select_with_device_ok", count: data.length });
        return;
      }

      // 2) fallback without device column
      const second = await supabase
        .from("devices")
        .select("id, canonical_name, min_stock")
        .order("canonical_name", { ascending: true });

      if (second.error) {
        setDebug({ step: "select_fallback_failed", error: second.error.message });
        throw second.error;
      }

      const data2 = (second.data as any[]) || [];
      setRows(data2);
      setDebug({ step: "select_fallback_ok", count: data2.length });
    } catch (e: any) {
      toast({ kind: "error", title: "Devices load failed", message: e?.message || "Error" });
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
      return toast({ kind: "error", title: "Invalid name", message: "Device name must contain letters/numbers." });
    }

    setLoading(true);
    try {
      // Insert with canonical_name always (NOT NULL)
      let res = await supabase.from("devices").insert({
        canonical_name,
        device: display,
        min_stock: Number.isFinite(newMin) ? Number(newMin) : 0,
      } as any);

      // If "device" column doesn't exist, fallback
      if (res.error) {
        const msg = String(res.error.message || "").toLowerCase();
        if (msg.includes("could not find the 'device' column") || (msg.includes("column") && msg.includes("device"))) {
          res = await supabase.from("devices").insert({
            canonical_name,
            min_stock: Number.isFinite(newMin) ? Number(newMin) : 0,
          } as any);
        }
      }

      if (res.error) throw res.error;

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

  async function saveMinStock(r: DeviceRow, min_stock: number) {
    if (!r.id) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("devices").update({ min_stock }).eq("id", r.id);
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
      {/* ✅ DEBUG BANNER */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <div className="font-semibold text-slate-100">Debug (pour trouver le vrai bug)</div>
        <div className="mt-2 text-slate-300">
          <div>
            <span className="text-slate-500">NEXT_PUBLIC_SUPABASE_URL: </span>
            <span className="font-mono break-all">{supabaseUrl}</span>
          </div>
          <div>
            <span className="text-slate-500">Load step: </span>
            <span className="font-mono">{debug.step}</span>
          </div>
          <div>
            <span className="text-slate-500">Rows loaded: </span>
            <span className="font-mono">{typeof debug.count === "number" ? debug.count : "—"}</span>
          </div>
          {debug.error ? (
            <div className="mt-2 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-rose-200">
              <div className="font-semibold">Select error</div>
              <div className="font-mono text-xs mt-1 break-all">{debug.error}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Admin</div>
          <h2 className="text-xl font-semibold">Devices</h2>
          <p className="text-sm text-slate-400 mt-1">
            Add devices + set min stock. Import uses <span className="text-slate-200 font-semibold">canonical_name</span>.
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
          <span className="text-slate-200 font-semibold">{newName.trim() ? canonicalize(newName) : "—"}</span>
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
                <tr key={r.id || r.canonical_name} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800">
                    <div className="text-slate-100 font-semibold">{r.device || "—"}</div>
                  </td>
                  <td className="p-2 border-b border-slate-800">
                    <div className="text-slate-200">{r.canonical_name}</div>
                  </td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <input
                      type="number"
                      min={0}
                      defaultValue={String(Number(r.min_stock ?? 0))}
                      onBlur={(e) => saveMinStock(r, Number(e.target.value || 0))}
                      className="w-[120px] text-right border border-slate-800 bg-slate-950 text-slate-100 rounded-lg px-2 py-1"
                    />
                  </td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <span className="text-xs text-slate-500">auto-save on blur</span>
                  </td>
                </tr>
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