"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type LabelRow = {
  device: string;
  canonical_name?: string;
  box_no: string;
  qty: number;
  qr_data: string;
};

type PreviewResp = {
  ok: boolean;
  error?: string;
  mode?: "preview" | "commit";
  file_name?: string;
  location?: string;
  devices?: number;
  boxes?: number;
  items?: number;
  labels?: LabelRow[];
  zpl_all?: string;
};

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [location, setLocation] = useState("00");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);

  async function callEndpoint(path: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      toast({ kind: "error", title: "Please sign in first" });
      return null;
    }
    if (!file) {
      toast({ kind: "error", title: "Missing file" });
      return null;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("location", location);

    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const json = (await res.json()) as PreviewResp;
    if (!json.ok) {
      toast({ kind: "error", title: "Import failed", message: json.error || "Error" });
      return null;
    }
    return json;
  }

  async function doPreview() {
    setLoading(true);
    setPreview(null);
    try {
      const json = await callEndpoint("/api/inbound/preview");
      if (json) {
        setPreview(json);
        toast({ kind: "success", title: "Preview ready" });
      }
    } finally {
      setLoading(false);
    }
  }

  async function doCommit() {
    setLoading(true);
    try {
      const json = await callEndpoint("/api/inbound/commit");
      if (json) {
        setPreview(json); // show final result
        toast({ kind: "success", title: "Imported ✅" });
      }
    } finally {
      setLoading(false);
    }
  }

  const labels = preview?.labels || [];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">Import fournisseur</h2>
        <p className="text-sm text-slate-400 mt-1">
          Multi-devices dans 1 seul Excel (blocs côte à côte). Preview d'abord, puis confirmation.
        </p>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm text-slate-400">Étage</div>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
            >
              {["00", "01", "02", "03", "04", "05"].map((v) => (
                <option key={v} value={v}>
                  {v}
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

          <div className="flex items-center gap-2">
            <button
              onClick={doPreview}
              disabled={loading || !file}
              className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Preview"}
            </button>

            <button
              onClick={doCommit}
              disabled={loading || !preview?.ok || preview?.mode !== "preview"}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              title="Import after you validated the preview"
            >
              Confirm import
            </button>
          </div>
        </div>

        {preview?.ok ? (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-950/40 rounded-2xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500">Devices détectés</div>
              <div className="mt-2 text-2xl font-semibold">{preview.devices ?? 0}</div>
            </div>
            <div className="bg-slate-950/40 rounded-2xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500">Cartons (labels)</div>
              <div className="mt-2 text-2xl font-semibold">{preview.boxes ?? 0}</div>
            </div>
            <div className="bg-slate-950/40 rounded-2xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500">IMEI parsés</div>
              <div className="mt-2 text-2xl font-semibold">{preview.items ?? 0}</div>
            </div>
            <div className="bg-slate-950/40 rounded-2xl border border-slate-800 p-4">
              <div className="text-xs text-slate-500">Mode</div>
              <div className="mt-2 text-2xl font-semibold">{preview.mode || "—"}</div>
            </div>
          </div>
        ) : null}
      </div>

      {preview?.ok ? (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-sm font-semibold">Labels par gros carton</div>
              <div className="text-xs text-slate-500">
                QR contient uniquement les IMEI (1 par ligne). Device + BoxNR sur le label.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => preview.zpl_all && navigator.clipboard.writeText(preview.zpl_all)}
                disabled={!preview.zpl_all}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                Copy ZPL (ALL)
              </button>

              <button
                onClick={() => preview.zpl_all && downloadText(`labels_${new Date().toISOString().slice(0, 10)}.zpl`, preview.zpl_all)}
                disabled={!preview.zpl_all}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
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
                  <tr key={`${l.device}|${l.box_no}`} className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800">{l.device}</td>
                    <td className="p-2 border-b border-slate-800">{l.box_no}</td>
                    <td className="p-2 border-b border-slate-800 text-right font-semibold">{l.qty}</td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                          onClick={() => navigator.clipboard.writeText(l.qr_data)}
                        >
                          Copy QR data
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {labels.length === 0 ? (
                  <tr>
                    <td className="p-3 text-sm text-slate-400" colSpan={4}>
                      No labels.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Pour imprimer ZD220 : colle le ZPL dans ton outil Zebra (ou envoie le .zpl à l’imprimante).
          </div>
        </div>
      ) : null}
    </div>
  );
}