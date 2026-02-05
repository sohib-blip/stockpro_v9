"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { LOCATIONS } from "@/lib/device";

type HistoryRow = {
  import_id: string;
  created_at: string;

  created_by_email?: string | null;
  file_name?: string | null;

  location?: string | null;

  devices_count?: number | null;
  boxes_count?: number | null;
  items_count?: number | null;

  devices?: any; // jsonb array
};

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState<(typeof LOCATIONS)[number]>("00");

  const [loading, setLoading] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/inbound/history", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();
      if (!json.ok) {
        // non-blocking
        setHistory([]);
        setHistoryLoading(false);
        return;
      }

      setHistory(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!file) {
      toast({ kind: "error", title: "Choisis un fichier Excel" });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("location", location);

      const res = await fetch("/api/inbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast({
          kind: "error",
          title: "Import failed",
          message: json?.error || "Import error",
        });
        return;
      }

      toast({
        kind: "success",
        title: "Import réussi",
        message: `Étage: ${json.location} • Boxes: ${json.boxes} • Items: ${json.inserted_items}`,
      });

      setFile(null);
      await loadHistory();
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Import error" });
    } finally {
      setLoading(false);
    }
  }

  const formatDevices = (devices: any) => {
    if (!devices) return "";
    if (Array.isArray(devices)) return devices.slice(0, 12).join(", ") + (devices.length > 12 ? "…" : "");
    // sometimes jsonb arrives as string
    try {
      const parsed = typeof devices === "string" ? JSON.parse(devices) : devices;
      if (Array.isArray(parsed)) return parsed.slice(0, 12).join(", ") + (parsed.length > 12 ? "…" : "");
    } catch {}
    return "";
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h1 className="text-xl font-semibold">Import</h1>
        <p className="text-sm text-slate-400 mt-1">
          Choisis l’étage, importe ton Excel. QR = IMEIs only (1 par ligne). Label affiche Device + Box.
        </p>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          >
            {LOCATIONS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>

          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <button
            onClick={submit}
            disabled={!file || loading}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Import..." : "Importer"}
          </button>

          <button
            onClick={loadHistory}
            disabled={historyLoading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {historyLoading ? "Refreshing…" : "Refresh history"}
          </button>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="text-sm font-semibold">Historique imports</div>
        <div className="text-xs text-slate-500 mt-1">Derniers imports (max 50).</div>

        <div className="overflow-auto mt-3">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left border-b border-slate-800">Date</th>
                <th className="p-2 text-left border-b border-slate-800">Par</th>
                <th className="p-2 text-left border-b border-slate-800">Fichier</th>
                <th className="p-2 text-left border-b border-slate-800">Étage</th>
                <th className="p-2 text-right border-b border-slate-800">Boxes</th>
                <th className="p-2 text-right border-b border-slate-800">Items</th>
                <th className="p-2 text-right border-b border-slate-800">Devices</th>
                <th className="p-2 text-left border-b border-slate-800">Liste devices</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.import_id} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2 border-b border-slate-800">{r.created_by_email || "-"}</td>
                  <td className="p-2 border-b border-slate-800">{r.file_name || "-"}</td>
                  <td className="p-2 border-b border-slate-800">{r.location || "-"}</td>
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">{Number(r.boxes_count ?? 0)}</td>
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">{Number(r.items_count ?? 0)}</td>
                  <td className="p-2 border-b border-slate-800 text-right">{Number(r.devices_count ?? 0)}</td>
                  <td className="p-2 border-b border-slate-800">
                    <div className="text-xs text-slate-300 break-words">{formatDevices(r.devices)}</div>
                  </td>
                </tr>
              ))}

              {history.length === 0 && (
                <tr>
                  <td className="p-3 text-slate-400" colSpan={8}>
                    {historyLoading ? "Chargement…" : "Aucun import (ou étape 3 pas encore faite)."}
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