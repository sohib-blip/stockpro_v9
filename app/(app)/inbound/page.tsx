"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type LabelRow = {
  device: string;
  box_no: string;
  qty: number;
  qr_data: string;
  box_id?: string | null;
};

export default function InboundImportPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState<string>("00");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);

  const [preview, setPreview] = useState<any | null>(null);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [committed, setCommitted] = useState(false);

  const [q, setQ] = useState("");

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  async function onPreview() {
    try {
      setCommitted(false);
      setPreview(null);
      setLabels([]);
      setLoadingPreview(true);

      if (!file) {
        toast({ kind: "error", title: "File missing", message: "Choisis un fichier Excel." });
        return;
      }

      const token = await getAccessToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("location", location);

      const res = await fetch("/api/inbound/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Preview failed");
      }

      setPreview(json);
      setLabels((json.labels || []) as LabelRow[]);
    } catch (e: any) {
      toast({ kind: "error", title: "Preview failed", message: e?.message || "Error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function onConfirmImport() {
    try {
      setLoadingCommit(true);

      if (!file) {
        toast({ kind: "error", title: "File missing", message: "Choisis un fichier Excel." });
        return;
      }

      const token = await getAccessToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("location", location);

      const res = await fetch("/api/inbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Import failed");

      setCommitted(true);
      setPreview(json);
      setLabels((json.labels || []) as LabelRow[]);

      toast({
        kind: "success",
        title: "Import OK",
        message: `${json.devices} devices · ${json.boxes} cartons · ${json.items} IMEI`,
      });
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Error" });
    } finally {
      setLoadingCommit(false);
    }
  }

  async function downloadPdfAllAfterConfirm() {
    const box_ids = (labels || [])
      .map((l) => l.box_id)
      .filter((x): x is string => Boolean(x));

    if (!box_ids.length) {
      toast({ kind: "error", title: "PDF", message: "Aucun box_id trouvé. Confirme l’import d’abord." });
      return;
    }

    const token = await getAccessToken();
    const res = await fetch("/api/labels/pdf/boxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ box_ids }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg || "PDF generation failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labels-${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadPdfOneAfterConfirm(box_id: string, device: string, box_no: string) {
    const token = await getAccessToken();
    const res = await fetch("/api/labels/pdf/boxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ box_ids: [box_id] }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(msg || "PDF generation failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `label-${device}-${box_no}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return labels;
    return labels.filter((l) => {
      const d = String(l.device ?? "").toLowerCase();
      const b = String(l.box_no ?? "").toLowerCase();
      return d.includes(qq) || b.includes(qq);
    });
  }, [labels, q]);

  const stats = useMemo(() => {
    const devices = new Set(labels.map((l) => l.device)).size;
    const boxes = labels.length;
    const items = labels.reduce((acc, l) => acc + (Number(l.qty) || 0), 0);
    return { devices, boxes, items };
  }, [labels]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Import fournisseur</h2>
          <p className="text-sm text-slate-400 mt-1">
            Multi-devices dans 1 seul Excel. Après confirm: PDF labels téléchargeable direct.
          </p>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-400">Étage</div>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
            >
              <option value="00">00</option>
              <option value="1">1</option>
              <option value="6">6</option>
              <option value="cabinet">cabinet</option>
            </select>
          </div>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
          />

          <div className="flex gap-2 justify-end">
            <button
              onClick={onPreview}
              disabled={loadingPreview || loadingCommit || !file}
              className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingPreview ? "Preview…" : "Preview"}
            </button>

            <button
              onClick={onConfirmImport}
              disabled={loadingCommit || loadingPreview || !file}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {loadingCommit ? "Import…" : "Confirm import"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard title="Devices détectés" value={stats.devices} />
          <StatCard title="Cartons (labels)" value={stats.boxes} />
          <StatCard title="IMEI parsés" value={stats.items} />
          <StatCard title="Étage" value={location} />
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Labels par gros carton</div>
            <div className="text-xs text-slate-500">PDF dispo après Confirm import.</div>
          </div>

          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filtrer device / carton…"
              className="w-full md:w-[260px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
            />

            <button
              onClick={async () => {
                try {
                  if (!committed) {
                    toast({ kind: "error", title: "PDF", message: "D’abord Confirm import." });
                    return;
                  }
                  await downloadPdfAllAfterConfirm();
                } catch (e: any) {
                  toast({ kind: "error", title: "PDF failed", message: e?.message || "Error" });
                }
              }}
              disabled={!committed || loadingCommit || !labels.length}
              className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              Download PDF (ALL)
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
              {filtered.map((l) => (
                <tr key={`${l.device}__${l.box_no}`} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800 font-semibold text-slate-100">{l.device}</td>
                  <td className="p-2 border-b border-slate-800 text-slate-200">{l.box_no}</td>
                  <td className="p-2 border-b border-slate-800 text-right text-slate-200">{l.qty}</td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <button
                      onClick={async () => {
                        try {
                          if (!committed) {
                            toast({ kind: "error", title: "PDF", message: "D’abord Confirm import." });
                            return;
                          }
                          if (!l.box_id) {
                            toast({ kind: "error", title: "PDF", message: "box_id manquant pour ce carton." });
                            return;
                          }
                          await downloadPdfOneAfterConfirm(l.box_id, l.device, l.box_no);
                        } catch (e: any) {
                          toast({ kind: "error", title: "PDF failed", message: e?.message || "Error" });
                        }
                      }}
                      disabled={!committed || !l.box_id}
                      className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                    >
                      Download PDF
                    </button>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="p-3 text-sm text-slate-400" colSpan={4}>
                    No labels.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {preview?.error && (
          <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/40 text-red-200 px-3 py-2 text-sm">
            {String(preview.error)}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: any }) {
  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="text-xl font-semibold text-slate-100 mt-1">{String(value)}</div>
    </div>
  );
}