"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type LabelRow = {
  device: string;
  box_no: string;
  qty: number;
  qr_data: string;
};

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState<string>("00");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);

  const [preview, setPreview] = useState<{
    ok: boolean;
    file_name?: string;
    devices?: number;
    boxes?: number;
    items?: number;
    labels?: LabelRow[];
    zpl_all?: string;
  } | null>(null);

  const STAGES = ["00", "1", "6", "cabinet"]; // ✅ only these

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  async function runPreview() {
    if (!file) return toast({ kind: "error", title: "Choisis un fichier Excel" });

    setLoadingPreview(true);
    setPreview(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not logged in");

      const form = new FormData();
      form.append("file", file);
      form.append("location", location);

      const res = await fetch("/api/inbound/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Preview failed");

      setPreview(json);
      toast({ kind: "success", title: "Preview OK", message: `${json.devices} device(s), ${json.boxes} carton(s)` });
    } catch (e: any) {
      toast({ kind: "error", title: "Preview failed", message: e?.message || "Error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  // NOTE: commit endpoint depends on your existing /api/inbound/commit
  // If your commit expects parsed payload instead of file, tell me and I adapt.
  async function confirmImport() {
    if (!file) return toast({ kind: "error", title: "Choisis un fichier Excel" });
    if (!preview?.ok) return toast({ kind: "error", title: "Fais d'abord Preview" });

    setLoadingCommit(true);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not logged in");

      const form = new FormData();
      form.append("file", file);
      form.append("location", location);

      const res = await fetch("/api/inbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Import failed");

      toast({ kind: "success", title: "Import OK", message: `${json.items || 0} IMEI importés` });
      // keep preview, user may still download zpl
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Error" });
    } finally {
      setLoadingCommit(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast({ kind: "success", title: "Copié" });
  }

  function downloadText(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const labels = preview?.labels || [];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">Import fournisseur</h2>
        <p className="text-sm text-slate-400 mt-1">
          Support multi-devices (3,4,5+) dans 1 seul Excel. Grouping + labels = <b>gros carton</b>.
        </p>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="grid grid-cols-1 lg:grid-cols-[160px_1fr_140px_160px] gap-3 items-center">
          <div className="flex items-center gap-2">
            <div className="text-sm text-slate-400 w-[60px]">Étage</div>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
          />

          <button
            onClick={runPreview}
            disabled={loadingPreview || !file}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loadingPreview ? "Preview…" : "Preview"}
          </button>

          <button
            onClick={confirmImport}
            disabled={loadingCommit || !preview?.ok}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loadingCommit ? "Import…" : "Confirm import"}
          </button>
        </div>

        <div className="text-xs text-slate-500 mt-2">
          Après preview : labels par gros carton + ZPL prêt pour ZD220 (QR = IMEI-only, 1 par ligne).
        </div>
      </div>

      {preview?.ok && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Stat title="Devices détectés" value={String(preview.devices ?? 0)} />
            <Stat title="Cartons (labels)" value={String(preview.boxes ?? 0)} />
            <Stat title="IMEI parsés" value={String(preview.items ?? 0)} />
            <Stat title="Étage" value={String(location)} />
          </div>

          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold">Labels par gros carton</div>
                <div className="text-xs text-slate-500">
                  QR = IMEI uniquement (1 par ligne). Device + BoxNR sur le label.
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => preview.zpl_all && copy(preview.zpl_all)}
                  disabled={!preview.zpl_all}
                  className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Copy ZPL (ALL)
                </button>
                <button
                  onClick={() => preview.zpl_all && downloadText("labels.zpl", preview.zpl_all)}
                  disabled={!preview.zpl_all}
                  className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Download .ZPL
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="text-left p-2 border-b border-slate-800">Device</th>
                    <th className="text-left p-2 border-b border-slate-800">Gros carton (BoxNR)</th>
                    <th className="text-right p-2 border-b border-slate-800">Qty IMEI</th>
                    <th className="text-right p-2 border-b border-slate-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {labels.map((l) => (
                    <tr key={`${l.device}-${l.box_no}`} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800 font-semibold">{l.device}</td>
                      <td className="p-2 border-b border-slate-800">{l.box_no}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{l.qty}</td>
                      <td className="p-2 border-b border-slate-800 text-right">
                        <button
                          onClick={() => copy(l.qr_data)}
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          Copy QR data
                        </button>
                      </td>
                    </tr>
                  ))}

                  {labels.length === 0 && (
                    <tr>
                      <td className="p-3 text-sm text-slate-400" colSpan={4}>
                        No labels.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500 mt-2">
              Pour imprimer ZD220 : colle le ZPL dans ton outil Zebra (ou envoie le fichier .zpl à l’imprimante).
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}