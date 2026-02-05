"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { LOCATIONS } from "@/lib/device";

type InboundResp = {
  ok: boolean;
  error?: string;

  import_id?: string;
  file_name?: string;
  location?: string;

  boxes?: number;
  devices?: number;
  parsed_items?: number;
  inserted_items?: number;

  labels?: Array<{
    box_id: string;
    device: string;
    box_no: string; // ✅ BIG CARTON
    qty: number;
    qr_data: string; // ✅ IMEI-only, one per line
    imeis?: string[];
  }>;

  zpl_all?: string;
};

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

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

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [location, setLocation] = useState<(typeof LOCATIONS)[number]>("00");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InboundResp | null>(null);

  const [filter, setFilter] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function runImport() {
    if (!file) {
      toast({ kind: "error", title: "Choisis un fichier Excel" });
      return;
    }

    setLoading(true);
    setResult(null);

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

      const json = (await res.json()) as InboundResp;

      if (!res.ok || !json.ok) {
        toast({ kind: "error", title: "Import failed", message: json.error || "Error" });
        setResult(json);
        return;
      }

      setResult(json);
      toast({ kind: "success", title: "Import OK" });
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  const labelsAll = Array.isArray(result?.labels) ? result!.labels! : [];
  const q = filter.trim().toLowerCase();
  const labels = labelsAll.filter((l) => {
    if (!q) return true;
    return (
      String(l.device ?? "").toLowerCase().includes(q) ||
      String(l.box_no ?? "").toLowerCase().includes(q)
    );
  });

  const zplAll = String(result?.zpl_all ?? "");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h1 className="text-xl font-semibold">Import fournisseur</h1>
          <p className="text-sm text-slate-400 mt-1">
            Support multi-devices dans 1 seul Excel. Grouping + labels = <b>gros carton</b>.
          </p>
        </div>
      </div>

      {/* Import card */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">Import</div>

        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-500">Étage</div>
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
          </div>

          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full md:w-auto"
          />

          <button
            onClick={runImport}
            disabled={loading || !file}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Importing…" : "Import"}
          </button>
        </div>

        <div className="text-xs text-slate-500">
          Après import : preview par carton + ZPL prêt pour ZD220 (QR = IMEI-only, 1 par ligne).
        </div>
      </div>

      {/* Result summary */}
      {result?.ok ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Devices détectés" value={result.devices ?? 0} />
            <Stat label="Cartons (labels)" value={result.boxes ?? 0} />
            <Stat label="IMEI parsés" value={result.parsed_items ?? 0} />
            <Stat label="IMEI insérés" value={result.inserted_items ?? 0} />
          </div>

          {/* Actions */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Labels par gros carton</div>
                <div className="text-xs text-slate-500">
                  Device + BoxNR (gros carton) + qty. QR contient uniquement les IMEI.
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrer device / carton…"
                  className="w-full md:w-[280px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
                />

                <button
                  onClick={async () => {
                    if (!zplAll) {
                      toast({ kind: "error", title: "No ZPL found" });
                      return;
                    }
                    await copyToClipboard(zplAll);
                    toast({ kind: "success", title: "ZPL copied (ALL)" });
                  }}
                  className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                >
                  Copy ZPL (ALL)
                </button>

                <button
                  onClick={() => {
                    if (!zplAll) {
                      toast({ kind: "error", title: "No ZPL found" });
                      return;
                    }
                    downloadText(`labels_${result.import_id || "import"}.zpl`, zplAll);
                    toast({ kind: "success", title: "ZPL downloaded" });
                  }}
                  className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                >
                  Download .ZPL
                </button>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="p-2 text-left border-b border-slate-800">Device</th>
                    <th className="p-2 text-left border-b border-slate-800">Gros carton (BoxNR)</th>
                    <th className="p-2 text-right border-b border-slate-800">Qty IMEI</th>
                    <th className="p-2 text-right border-b border-slate-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {labels.map((l) => (
                    <tr key={l.box_id || `${l.device}__${l.box_no}`} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800 font-semibold">{l.device}</td>
                      <td className="p-2 border-b border-slate-800">{l.box_no}</td>
                      <td className="p-2 border-b border-slate-800 text-right font-semibold">{l.qty}</td>
                      <td className="p-2 border-b border-slate-800 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            onClick={async () => {
                              // Build per-label ZPL directly from payload if needed
                              // Here: easiest is to slice from qr_data + keep same layout as your API ZPL
                              const zpl = buildZplClient(l.qr_data, l.device, l.box_no);
                              await copyToClipboard(zpl);
                              toast({ kind: "success", title: "ZPL copied", message: `${l.device} — ${l.box_no}` });
                            }}
                            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                          >
                            Copy ZPL
                          </button>

                          <button
                            onClick={() => {
                              const zpl = buildZplClient(l.qr_data, l.device, l.box_no);
                              downloadText(`label_${l.device}_${sanitizeFile(l.box_no)}.zpl`, zpl);
                              toast({ kind: "success", title: "ZPL downloaded" });
                            }}
                            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                          >
                            Download
                          </button>

                          <button
                            onClick={async () => {
                              await copyToClipboard(String(l.qr_data || ""));
                              toast({ kind: "success", title: "QR data copied (IMEIs only)" });
                            }}
                            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                          >
                            Copy QR data
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {labels.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-3 text-slate-400">
                        Aucun label trouvé.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-500">
              Pour imprimer ZD220 : tu peux coller le ZPL dans ton outil Zebra (ou envoyer le fichier .zpl à l’imprimante).
            </div>
          </div>
        </>
      ) : result && !result.ok ? (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {result.error || "Import error"}
        </div>
      ) : null}
    </div>
  );
}

function sanitizeFile(s: string) {
  return String(s || "")
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replaceAll(":", "-")
    .replaceAll("*", "-")
    .replaceAll("?", "-")
    .replaceAll('"', "-")
    .replaceAll("<", "-")
    .replaceAll(">", "-")
    .replaceAll("|", "-")
    .trim();
}

function buildZplClient(qrData: string, device: string, boxNo: string) {
  // Must match your server ZPL format (ZD220)
  return `
^XA
^PW600
^LL400
^CI28

^FO30,30
^BQN,2,8
^FDLA,${String(qrData || "")}^FS

^FO320,70
^A0N,35,35
^FD${String(device || "")}^FS

^FO320,120
^A0N,30,30
^FDBox: ${String(boxNo || "")}^FS

^XZ
`.trim();
}