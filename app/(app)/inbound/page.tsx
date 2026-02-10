"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type LabelRow = {
  device: string;
  box_no: string;
  qty: number;
  qr_data: string;
  box_id?: string | null;
};

type ImportLogRow = {
  id: string;
  created_at: string;
  vendor: string;
  location: string | null;
  file_name: string | null;
  created_by_email: string | null;
  devices: number;
  boxes: number;
  items: number;
};

type ImportLogBoxRow = {
  id: string;
  created_at: string;
  box_id: string | null;
  device: string;
  box_no: string;
  qty: number;
};

export default function InboundImportPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  // Upload + preview/commit
  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState<string>("00");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);

  // Response (keep for toast + optional future)
  const [preview, setPreview] = useState<any | null>(null);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [committed, setCommitted] = useState(false);

  // History states (two blocks)
  const [loadingHistImport, setLoadingHistImport] = useState(false);
  const [imports, setImports] = useState<ImportLogRow[]>([]);

  const [loadingHistLabels, setLoadingHistLabels] = useState(false);
  const [importsFromLabels, setImportsFromLabels] = useState<ImportLogRow[]>([]);

  // Details (shared)
  const [openKey, setOpenKey] = useState<string | null>(null); // e.g. "import:<id>" or "labels:<id>"
  const [openBoxes, setOpenBoxes] = useState<ImportLogBoxRow[]>([]);
  const [loadingBoxes, setLoadingBoxes] = useState(false);

  // Filter
  const [qImport, setQImport] = useState("");
  const [qLabels, setQLabels] = useState("");

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  // ---------------------------
  // Preview + Commit
  // ---------------------------
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
      form.append("vendor", "teltonika");

      const res = await fetch("/api/inbound/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Preview failed");

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
      form.append("vendor", "teltonika");

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

      // refresh import history right away
      await loadImportHistory();
      await loadLabelsHistory();
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Error" });
    } finally {
      setLoadingCommit(false);
    }
  }

  // ---------------------------
  // Histories
  // ---------------------------
  async function loadImportHistory() {
    try {
      setLoadingHistImport(true);
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch("/api/inbound/history?limit=80", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Import history load failed");

      setImports((json.imports || []) as ImportLogRow[]);
    } catch (e: any) {
      toast({ kind: "error", title: "History failed", message: e?.message || "Error" });
      setImports([]);
    } finally {
      setLoadingHistImport(false);
    }
  }

  async function loadLabelsHistory() {
    try {
      setLoadingHistLabels(true);
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch("/api/inbound/history-from-labels?limit=80", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Labels history load failed");

      setImportsFromLabels((json.imports || []) as ImportLogRow[]);
    } catch (e: any) {
      toast({ kind: "error", title: "History failed", message: e?.message || "Error" });
      setImportsFromLabels([]);
    } finally {
      setLoadingHistLabels(false);
    }
  }

  async function loadBoxesForImport(scope: "import" | "labels", importId: string) {
    setLoadingBoxes(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const res = await fetch(`/api/inbound/${scope === "labels" ? "history-from-labels" : "history"}/${importId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Details load failed");

      setOpenBoxes((json.boxes || []) as ImportLogBoxRow[]);
    } finally {
      setLoadingBoxes(false);
    }
  }

  async function toggleDetails(scope: "import" | "labels", importId: string) {
    const key = `${scope}:${importId}`;
    if (openKey === key) {
      setOpenKey(null);
      setOpenBoxes([]);
      return;
    }
    setOpenKey(key);
    setOpenBoxes([]);
    await loadBoxesForImport(scope, importId);
  }

  // ---------------------------
  // PDF for an import (all boxes)
  // ---------------------------
  async function downloadPdfForBoxIds(box_ids: string[], filename: string) {
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
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadPdfForImport(scope: "import" | "labels", importId: string) {
    try {
      // ensure boxes loaded
      if (!(openKey === `${scope}:${importId}`) || openBoxes.length === 0) {
        await toggleDetails(scope, importId);
      }

      const ids = (openBoxes || [])
        .map((b) => b.box_id)
        .filter((x): x is string => Boolean(x));

      if (!ids.length) {
        toast({ kind: "error", title: "PDF", message: "Aucun box_id trouvé pour cet import." });
        return;
      }

      const fn = `${scope}-import-${importId}-${new Date().toISOString().slice(0, 10)}.pdf`;
      await downloadPdfForBoxIds(ids, fn);
    } catch (e: any) {
      toast({ kind: "error", title: "PDF failed", message: e?.message || "Error" });
    }
  }

  // ---------------------------
  // Filters (both histories)
  // ---------------------------
  const filteredImports = useMemo(() => {
    const qq = qImport.trim().toLowerCase();
    if (!qq) return imports;
    return imports.filter((im) => {
      const v = String(im.vendor ?? "").toLowerCase();
      const u = String(im.created_by_email ?? "").toLowerCase();
      const f = String(im.file_name ?? "").toLowerCase();
      const loc = String(im.location ?? "").toLowerCase();
      return v.includes(qq) || u.includes(qq) || f.includes(qq) || loc.includes(qq);
    });
  }, [imports, qImport]);

  const filteredLabelsImports = useMemo(() => {
    const qq = qLabels.trim().toLowerCase();
    if (!qq) return importsFromLabels;
    return importsFromLabels.filter((im) => {
      const u = String(im.created_by_email ?? "").toLowerCase();
      const loc = String(im.location ?? "").toLowerCase();
      return u.includes(qq) || loc.includes(qq);
    });
  }, [importsFromLabels, qLabels]);

  useEffect(() => {
    loadImportHistory();
    loadLabelsHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewStats = useMemo(() => {
    const devices = new Set(labels.map((l) => l.device)).size;
    const boxes = labels.length;
    const items = labels.reduce((acc, l) => acc + (Number(l.qty) || 0), 0);
    return { devices, boxes, items };
  }, [labels]);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Import fournisseur</h2>
          <p className="text-sm text-slate-400 mt-1">Preview + Confirm, et après tu as l’historique en bas.</p>
        </div>
      </div>

      {/* UPLOAD */}
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

        {/* Preview stats only */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard title="Preview Devices" value={previewStats.devices} />
          <StatCard title="Preview Boxes" value={previewStats.boxes} />
          <StatCard title="Preview IMEI" value={previewStats.items} />
          <StatCard title="Étage" value={location} />
        </div>

        {preview?.error && (
          <div className="mt-3 rounded-xl border border-red-900/50 bg-red-950/40 text-red-200 px-3 py-2 text-sm">
            {String(preview.error)}
          </div>
        )}

        {committed && (
          <div className="mt-2 rounded-xl border border-emerald-900/50 bg-emerald-950/30 text-emerald-200 px-3 py-2 text-sm">
            Import confirmé ✅ (check l’historique en bas)
          </div>
        )}
      </div>

      {/* HISTORY: IMPORTS (non-labels) */}
      <HistoryBlock
        title="Import history"
        subtitle="Historique des imports fournisseurs (teltonika etc.)."
        query={qImport}
        setQuery={setQImport}
        loading={loadingHistImport}
        onRefresh={loadImportHistory}
        rows={filteredImports}
        openKey={openKey}
        openBoxes={openBoxes}
        loadingBoxes={loadingBoxes}
        onToggle={(id) => toggleDetails("import", id)}
        onDownloadPdf={(id) => downloadPdfForImport("import", id)}
        showVendor
        showDevices
      />

      {/* HISTORY: IMPORTS FROM LABELS */}
      <HistoryBlock
        title="Import from Labels"
        subtitle="Historique des imports faits depuis l’onglet Labels."
        query={qLabels}
        setQuery={setQLabels}
        loading={loadingHistLabels}
        onRefresh={loadLabelsHistory}
        rows={filteredLabelsImports}
        openKey={openKey}
        openBoxes={openBoxes}
        loadingBoxes={loadingBoxes}
        onToggle={(id) => toggleDetails("labels", id)}
        onDownloadPdf={(id) => downloadPdfForImport("labels", id)}
        showVendor={false}
        showDevices
      />
    </div>
  );
}

function HistoryBlock({
  title,
  subtitle,
  query,
  setQuery,
  loading,
  onRefresh,
  rows,
  openKey,
  openBoxes,
  loadingBoxes,
  onToggle,
  onDownloadPdf,
  showVendor,
  showDevices,
}: {
  title: string;
  subtitle: string;
  query: string;
  setQuery: (v: string) => void;
  loading: boolean;
  onRefresh: () => Promise<void>;
  rows: ImportLogRow[];
  openKey: string | null;
  openBoxes: ImportLogBoxRow[];
  loadingBoxes: boolean;
  onToggle: (importId: string) => void;
  onDownloadPdf: (importId: string) => void;
  showVendor: boolean;
  showDevices: boolean;
}) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search… (user, étage, file, vendor)"
            className="w-full md:w-[320px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />

          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="text-left p-2 border-b border-slate-800">Date</th>
              <th className="text-left p-2 border-b border-slate-800">User</th>
              {showVendor ? <th className="text-left p-2 border-b border-slate-800">Vendor</th> : null}
              <th className="text-left p-2 border-b border-slate-800">Étage</th>
              {showDevices ? <th className="text-right p-2 border-b border-slate-800">Devices</th> : null}
              <th className="text-right p-2 border-b border-slate-800">Boxes</th>
              <th className="text-right p-2 border-b border-slate-800">Items</th>
              <th className="text-right p-2 border-b border-slate-800">Actions</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((im) => {
              const key1 = `import:${im.id}`;
              const key2 = `labels:${im.id}`;
              const isOpen = openKey === key1 || openKey === key2;

              return (
                <React.Fragment key={im.id}>
                  <tr className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800 text-slate-200">{new Date(im.created_at).toLocaleString()}</td>
                    <td className="p-2 border-b border-slate-800 text-slate-200">{im.created_by_email || "—"}</td>
                    {showVendor ? <td className="p-2 border-b border-slate-800 text-slate-200">{im.vendor || "—"}</td> : null}
                    <td className="p-2 border-b border-slate-800 text-slate-200">{im.location || "—"}</td>
                    {showDevices ? <td className="p-2 border-b border-slate-800 text-right text-slate-200">{im.devices ?? 0}</td> : null}
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{im.boxes ?? 0}</td>
                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{im.items ?? 0}</td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => onToggle(im.id)}
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          {isOpen ? "Hide" : "Details"}
                        </button>

                        <button
                          onClick={() => onDownloadPdf(im.id)}
                          className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                        >
                          Download PDF (Import)
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr>
                      <td className="p-3 border-b border-slate-800 bg-slate-950/30" colSpan={showVendor ? (showDevices ? 8 : 7) : (showDevices ? 7 : 6)}>
                        {loadingBoxes ? (
                          <div className="text-sm text-slate-400">Loading…</div>
                        ) : openBoxes.length ? (
                          <div className="overflow-auto">
                            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                              <thead className="bg-slate-950/50">
                                <tr>
                                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                                  <th className="text-left p-2 border-b border-slate-800">BoxNR</th>
                                  <th className="text-right p-2 border-b border-slate-800">Qty</th>
                                  <th className="text-left p-2 border-b border-slate-800">box_id</th>
                                </tr>
                              </thead>
                              <tbody>
                                {openBoxes.map((b) => (
                                  <tr key={b.id} className="hover:bg-slate-950/50">
                                    <td className="p-2 border-b border-slate-800 text-slate-100 font-semibold">{b.device}</td>
                                    <td className="p-2 border-b border-slate-800 text-slate-200">{b.box_no}</td>
                                    <td className="p-2 border-b border-slate-800 text-right text-slate-200">{b.qty}</td>
                                    <td className="p-2 border-b border-slate-800 text-slate-500">{b.box_id || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-sm text-slate-400">No details.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-sm text-slate-400" colSpan={showVendor ? (showDevices ? 8 : 7) : (showDevices ? 7 : 6)}>
                  Aucun résultat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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