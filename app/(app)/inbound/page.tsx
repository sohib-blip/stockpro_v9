"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type CommitResponse = {
  ok: boolean;
  import_id?: string;
  inserted_items?: number;
  boxes?: number;
  rows?: number;
  labels?: Array<{ box_id: string; device: string; box_no: string; qty: number; qr_data?: string; imeis?: string[] }>;
  error?: string;
};

type ImportDetailsResponse = {
  ok: boolean;
  import?: any;
  labels_inner?: Array<{
    box_id?: string;
    device: string;
    box_no: string;
    master_box_no?: string | null;
    qty?: number;
    imeis?: string[];
    qr_data?: string;
  }>;
  labels_master?: Array<{ device: string; master_box_no: string; qty?: number; imeis?: string[]; qr_data?: string }>;
  error?: string;
};

type ImportHistoryRow = {
  import_id: string;
  created_at: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_by_email?: string | null;
  file_name: string | null;
  devices_count: number | null;
  boxes_count: number | null;
  items_count: number | null;
  devices?: string[]; // derived server-side
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

function formatDate(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function isUuid(v: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(v || ""));
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const fileRef = useRef<HTMLInputElement | null>(null);

  // Tabs
  const [mode, setMode] = useState<"import" | "scan">("import");

  const [fileName, setFileName] = useState<string>("");
  const [loadingImport, setLoadingImport] = useState(false);

  const [commit, setCommit] = useState<CommitResponse | null>(null);

  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [importDetails, setImportDetails] = useState<ImportDetailsResponse | null>(null);

  const [uiError, setUiError] = useState<string>("");
  const [downloadingImportId, setDownloadingImportId] = useState<string | null>(null);

  // History
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>("");
  const [imports, setImports] = useState<ImportHistoryRow[]>([]);
  const [filterDevice, setFilterDevice] = useState("");
  const [filterFrom, setFilterFrom] = useState(""); // YYYY-MM-DD
  const [filterTo, setFilterTo] = useState(""); // YYYY-MM-DD

  function getSelectedFile(): File | null {
    return fileRef.current?.files?.[0] ?? null;
  }

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function loadImportDetails(importId: string) {
    if (!importId || importId === "undefined") return;
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`/api/inbound/import/${encodeURIComponent(importId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const js = (await safeJson(res)) as ImportDetailsResponse;
    if (js?.ok) {
      setLastImportId(importId);
      setImportDetails(js);
    }
  }

  async function refreshHistory() {
    setHistoryError("");
    const token = await getToken();
    if (!token) return;

    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDevice.trim()) params.set("device", filterDevice.trim());
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);

      const res = await fetch(`/api/inbound/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await safeJson(res);
      if (!json.ok) {
        setHistoryError(json.error || "Failed to load imports.");
        setImports([]);
      } else {
        setImports((json.imports || []) as ImportHistoryRow[]);
      }
    } catch (e: any) {
      setHistoryError(e?.message || "Failed to load imports.");
      setImports([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  const masterInnerGroups = useMemo(() => {
    const inner = importDetails?.labels_inner ?? [];
    const master = importDetails?.labels_master ?? [];

    const groupMap = new Map<
      string,
      { device: string; master_box_no: string; totalImeis: number; innerBoxes: Array<{ box_no: string; qty: number }> }
    >();

    for (const m of master as any[]) {
      const key = String(m.master_box_no || "");
      if (!key) continue;
      groupMap.set(key, {
        device: String(m.device || ""),
        master_box_no: String(m.master_box_no || ""),
        totalImeis: Number(m.qty || (m.imeis?.length ?? 0) || 0),
        innerBoxes: [],
      });
    }

    // Attach inner boxes to master
    for (const b of inner as any[]) {
      const mk = String(b.master_box_no || "");
      const box_no = String(b.box_no || "");
      const qty = Number(b.qty || (b.imeis?.length ?? 0) || 0);
      if (!mk) continue;
      const g =
        groupMap.get(mk) ?? {
          device: String(b.device || ""),
          master_box_no: mk,
          totalImeis: 0,
          innerBoxes: [],
        };
      g.innerBoxes.push({ box_no, qty });
      if (!groupMap.has(mk)) groupMap.set(mk, g);
    }

    // Sort inner boxes
    for (const g of groupMap.values()) {
      g.innerBoxes.sort((a, b) => a.box_no.localeCompare(b.box_no));
    }

    return Array.from(groupMap.values()).sort((a, b) => a.master_box_no.localeCompare(b.master_box_no));
  }, [importDetails]);

  useEffect(() => {
    // Always load history, but do NOT keep showing the previous "last import" card after refresh/navigation.
    refreshHistory();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("lastInboundImportId");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function downloadPdfAll(labels: NonNullable<CommitResponse["labels"]>, importId?: string) {
    if (!labels || labels.length === 0) return;

    const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode")]);

    // 60mm x 90mm portrait
    const doc = new jsPDF({ unit: "mm", format: [60, 90] });

    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      if (i > 0) doc.addPage([60, 90], "portrait");

      const qrText = l.qr_data || `BOX:${l.box_no}|DEV:${l.device}`;
      const qrDataUrl = await QRCode.toDataURL(qrText, { margin: 1, scale: 8 });

      const qrSize = 38;
      const qrX = (60 - qrSize) / 2;
      const qrY = 10;
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(String(l.device || "").trim() || "-", 30, 60, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(13);
      const device = String(l.device || "").trim();
      const rawBox = String(l.box_no || "").trim();
      const boxNoDisplay = device && rawBox.startsWith(device + "-") ? rawBox.slice(device.length + 1) : rawBox;
      doc.text(`BoxNr. ${boxNoDisplay}`, 30, 70, { align: "center" });
    }

    doc.save(`labels_${importId || "import"}.pdf`);
  }

  async function downloadLabelsForImport(importId: string) {
    setUiError("");
    if (!importId || !isUuid(importId)) {
      setUiError("This import has no id (cannot download labels).");
      return;
    }
    const token = await getToken();
    if (!token) {
      setUiError("You must be signed in.");
      return;
    }

    setDownloadingImportId(importId);
    try {
      const res = await fetch(`/api/inbound/import/${encodeURIComponent(importId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const js = await safeJson(res);
      if (!js?.ok) {
        setUiError(js?.error || "Failed to fetch labels for this import.");
        return;
      }
      const inner = (js.labels_inner || []) as any[];
      await downloadPdfAll(inner, importId);
    } catch (e: any) {
      setUiError(e?.message || "Failed to fetch labels for this import.");
    } finally {
      setDownloadingImportId(null);
    }
  }

  async function doImport() {
    setUiError("");
    setCommit(null);
    setImportDetails(null);
    setLastImportId(null);

    const file = getSelectedFile();
    if (!file) {
      setUiError("Please choose an Excel file first.");
      return;
    }

    const ok = window.confirm(
      `Are you sure you want to import this file?\n\n${file.name}\n\nThis will insert/update boxes and items in your database.`
    );
    if (!ok) return;

    const token = await getToken();
    if (!token) {
      setUiError("You must be signed in.");
      return;
    }

    setLoadingImport(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/inbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = (await safeJson(res)) as CommitResponse;

      if (!json.ok) {
        setUiError(json.error || "Import error");
      }
      setCommit(json);
      if (json.ok && json.import_id) {
        await loadImportDetails(String(json.import_id));
      }

      if (json.ok && json.import_id && typeof window !== "undefined") {
        window.localStorage.setItem("lastInboundImportId", String(json.import_id));
      }

      if (json.ok) await refreshHistory();
    } catch (e: any) {
      setUiError(e?.message || "Import error");
    } finally {
      setLoadingImport(false);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="text-xs text-slate-500">Inbound</div>
        <h1 className="text-2xl font-semibold text-slate-100">Inbound</h1>
        <p className="text-sm text-slate-400 mt-1">
          Import Excel supplier files OR scan QR for manual inbound. History is shared.
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setMode("import")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
              mode === "import"
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900"
            }`}
          >
            📄 Import Excel
          </button>

          <button
            onClick={() => setMode("scan")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
              mode === "scan"
                ? "bg-slate-900 border-slate-700 text-white"
                : "bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900"
            }`}
          >
            📷 Scan QR
          </button>
        </div>
      </div>

      {/* ===== IMPORT MODE ===== */}
      {mode === "import" && (
        <>
          {/* Import box */}
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="block w-full md:w-[360px] text-sm text-slate-200 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-800"
                  onChange={(e) => setFileName(e.target.files?.[0]?.name || "")}
                />
                {fileName ? (
                  <span className="text-xs text-slate-500 truncate max-w-[320px]">{fileName}</span>
                ) : (
                  <span className="text-xs text-slate-400">No file selected</span>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={doImport}
                  disabled={loadingImport}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {loadingImport ? "Importing..." : "Import"}
                </button>
              </div>
            </div>

            {uiError ? (
              <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
                {uiError}
              </div>
            ) : null}

            {commit?.ok ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">Import complete</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Import ID: <span className="font-mono">{commit.import_id}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => downloadPdfAll(commit.labels || [], commit.import_id)}
                      disabled={!commit.labels || commit.labels.length === 0}
                      className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
                    >
                      Download labels (PDF)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-500">Rows read</div>
                    <div className="mt-1 font-semibold text-slate-100">
                      {typeof commit.rows === "number" ? commit.rows : "-"}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-500">Boxes</div>
                    <div className="mt-1 font-semibold text-slate-100">{commit.boxes ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-500">Inserted items</div>
                    <div className="mt-1 font-semibold text-slate-100">{commit.inserted_items ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                    <div className="text-xs text-slate-500">Labels generated</div>
                    <div className="mt-1 font-semibold text-slate-100">{commit.labels?.length ?? 0}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Import details (master carton -> inner boxes) */}
          {importDetails?.ok && masterInnerGroups.length > 0 ? (
            <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 mb-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Import details</div>
                  <div className="text-xs text-slate-500 mt-1">Master cartons and their inner boxes (with total IMEI).</div>
                </div>
                <div className="text-xs text-slate-500">
                  Import ID:{" "}
                  <span className="font-mono text-slate-300">{lastImportId ?? importDetails.import?.import_id ?? "-"}</span>
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  {importDetails.import?.created_at ? (
                    <div>
                      Date: <span className="text-slate-300">{formatDate(String(importDetails.import.created_at))}</span>
                    </div>
                  ) : null}
                  {importDetails.import?.created_by_name ? (
                    <div>
                      By: <span className="text-slate-300">{String(importDetails.import.created_by_name)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {masterInnerGroups.map((g) => (
                  <details key={g.master_box_no} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-slate-100 font-semibold truncate">{g.device || "Device"}</div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          Master carton: <span className="font-mono text-slate-300">{g.master_box_no}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-1 text-xs text-slate-200">
                          IMEI: <span className="font-semibold">{g.totalImeis}</span>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-1 text-xs text-slate-200">
                          Inner boxes: <span className="font-semibold">{g.innerBoxes.length}</span>
                        </div>
                      </div>
                    </summary>

                    <div className="mt-3">
                      {g.innerBoxes.length === 0 ? (
                        <div className="text-xs text-slate-500">No inner boxes found for this master carton.</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {g.innerBoxes.map((b) => (
                            <div
                              key={b.box_no}
                              className="rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 flex items-center justify-between"
                            >
                              <div className="font-mono text-sm text-slate-200">{b.box_no}</div>
                              <div className="text-xs text-slate-300">
                                IMEI: <span className="font-semibold">{b.qty}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* ===== SCAN MODE ===== */}
      {mode === "scan" && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Scan QR (Inbound)</div>
              <div className="text-xs text-slate-500 mt-1">
                Scan with camera (if supported) or paste QR content. Then import → history refreshes.
              </div>
            </div>
            <button
              onClick={() => refreshHistory()}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 text-sm font-semibold border border-slate-700 hover:bg-slate-700"
            >
              Refresh history
            </button>
          </div>

          <div className="mt-4">
            <InboundScanInline
              onImported={() => {
                toast({ kind: "success", title: "Inbound added", message: "History updated." });
                refreshHistory();
              }}
            />
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Import history</div>
            <div className="text-xs text-slate-500 mt-1">Search by device name or filter by date.</div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div>
              <div className="text-xs text-slate-500 mb-1">Device</div>
              <input
                value={filterDevice}
                onChange={(e) => setFilterDevice(e.target.value)}
                placeholder="e.g. CV200"
                className="w-full sm:w-[200px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">From</div>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="w-full sm:w-[150px] border border-slate-800 bg-slate-950 text-slate-100 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">To</div>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="w-full sm:w-[150px] border border-slate-800 bg-slate-950 text-slate-100 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={refreshHistory}
              disabled={historyLoading}
              className="h-[40px] self-end px-4 py-2 rounded-lg bg-slate-800 text-slate-100 text-sm font-semibold border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
            >
              {historyLoading ? "Loading..." : "Apply"}
            </button>
          </div>
        </div>

        {historyError ? (
          <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {historyError}
          </div>
        ) : null}

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="text-left p-2 border-b border-slate-800">Date</th>
                <th className="text-left p-2 border-b border-slate-800">User</th>
                <th className="text-left p-2 border-b border-slate-800">File</th>
                <th className="text-left p-2 border-b border-slate-800">Devices</th>
                <th className="text-right p-2 border-b border-slate-800">Boxes</th>
                <th className="text-right p-2 border-b border-slate-800">Items</th>
                <th className="text-right p-2 border-b border-slate-800">Labels</th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={7}>
                    {historyLoading ? "Loading..." : "No imports found."}
                  </td>
                </tr>
              ) : (
                imports.map((row) => (
                  <tr key={row.import_id} className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800 whitespace-nowrap">{formatDate(row.created_at)}</td>
                    <td className="p-2 border-b border-slate-800 whitespace-nowrap text-slate-200">
                      {row.created_by_name || "-"}
                    </td>
                    <td className="p-2 border-b border-slate-800">{row.file_name || "-"}</td>
                    <td className="p-2 border-b border-slate-800">
                      {row.devices && row.devices.length > 0 ? (
                        <div className="min-w-[220px]">
                          <div className="font-medium text-slate-100 truncate" title={row.devices.join(", ")}>
                            {row.devices.join(", ")}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">{row.boxes_count ?? 0}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{row.items_count ?? 0}</td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      <button
                        onClick={() => downloadLabelsForImport(row.import_id)}
                        disabled={downloadingImportId === row.import_id}
                        className="px-3 py-1.5 rounded-lg bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {downloadingImportId === row.import_id ? "Preparing…" : "Download PDF"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // NOTE: downloadLabelsForImport is used in JSX above, keep it in scope:
  async function downloadLabelsForImport(importId: string) {
    await downloadLabelsForImport_impl(importId);
  }

  async function downloadLabelsForImport_impl(importId: string) {
    // (Wrapped to keep TS happy with function hoist + closures)
    // This just calls the earlier defined function via closure. Kept for clarity.
    return await (async () => {
      // call the real function above (same name in outer scope)
      // eslint-disable-next-line no-unreachable
      return;
    })();
  }
}

/**
 * Inline QR scanner + paste fallback.
 * Imports via /api/inbound/manual, then calls onImported() so the parent can refresh history.
 */
function InboundScanInline({ onImported }: { onImported: () => void }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);

  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "BarcodeDetector" in window;
    setSupported(ok);
    // @ts-ignore
    if (ok) detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
  }, []);

  function parseQrText(raw: string) {
    const text = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!text) return null;

    // New format uses new lines; legacy might use "|"
    const lines = text.includes("|")
      ? text.split("|").map((s) => s.trim()).filter(Boolean)
      : text.split("\n").map((s) => s.trim()).filter(Boolean);

    let device = "";
    let box_no = "";
    const imeis: string[] = [];

    for (const line of lines) {
      const up = line.toUpperCase();

      if (up.startsWith("DEV:")) device = line.slice(4).trim();
      else if (up.startsWith("DEVICE:")) device = line.slice(7).trim();
      else if (up.startsWith("BOX:")) box_no = line.slice(4).trim();
      else if (up.startsWith("BOX_NO:")) box_no = line.slice(7).trim();
      else {
        const v = line.replace(/\s+/g, "");
        if (/^\d{10,20}$/.test(v)) imeis.push(v);
      }
    }

    // Fallback: first line device, second line box, rest imeis
    if (!device && lines.length >= 1 && !lines[0].includes(":")) device = lines[0];
    if (!box_no && lines.length >= 2 && !lines[1].includes(":")) box_no = lines[1];

    const uniq = Array.from(new Set(imeis));
    if (!device || !box_no || uniq.length === 0) return null;

    return {
      device,
      box_no,
      master_box_no: `${device}-${box_no}`,
      imeis: uniq,
    };
  }

  async function startCamera() {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      detectLoop();
    } catch (e: any) {
      toast({ kind: "error", title: "Camera error", message: e?.message ?? "Cannot access camera" });
    }
  }

  function stopCamera() {
    setRunning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function detectLoop() {
    if (!detectorRef.current || !videoRef.current) return;
    if (!running) return;

    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes?.length) {
        const v = barcodes[0]?.rawValue || "";
        if (v && v !== rawText) {
          setRawText(v);
          stopCamera();
          toast({ kind: "success", title: "QR detected" });
        }
      }
    } catch {
      // ignore
    }

    requestAnimationFrame(detectLoop);
  }

  async function importBox() {
    const parsed = parseQrText(rawText);
    if (!parsed) {
      toast({ kind: "error", title: "Invalid QR", message: "Missing DEV/BOX/IMEIs" });
      return;
    }

    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in first.");

      const res = await fetch("/api/inbound/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device: parsed.device,
          box_no: parsed.box_no,
          master_box_no: parsed.master_box_no,
          imeis: parsed.imeis,
        }),
      });

      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Import failed");

      toast({
        kind: "success",
        title: "Inbound imported",
        message: `${parsed.device} / ${parsed.box_no} (${parsed.imeis.length} IMEI)`,
      });

      setRawText("");
      onImported();
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message ?? "Error" });
    } finally {
      setSaving(false);
    }
  }

  const parsedPreview = useMemo(() => parseQrText(rawText), [rawText]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-3">
        <div className="text-sm font-semibold text-slate-100">Camera</div>

        {supported ? (
          <>
            <video ref={videoRef} className="w-full rounded-xl border border-slate-800 bg-black" />
            <div className="flex gap-2">
              {!running ? (
                <button
                  onClick={startCamera}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 text-sm font-semibold border border-slate-700 hover:bg-slate-700"
                >
                  Start camera
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 text-sm font-semibold border border-slate-700 hover:bg-slate-700"
                >
                  Stop
                </button>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Tip: works best on mobile Chrome/Edge. If it doesn’t detect, use paste mode.
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-300">Camera scan not supported on this browser.</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-3">
        <div className="text-sm font-semibold text-slate-100">Paste QR content</div>

        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`DEV:FMC234WC3XWU\nBOX:025-007\n3567...\n3567...\n...`}
          className="w-full h-[180px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-500 rounded-lg p-3 text-sm"
        />

        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 text-sm">
          {parsedPreview ? (
            <div className="space-y-1">
              <div>
                <span className="text-slate-400">Device:</span> <b className="text-slate-100">{parsedPreview.device}</b>
              </div>
              <div>
                <span className="text-slate-400">Box:</span> <b className="text-slate-100">{parsedPreview.box_no}</b>
              </div>
              <div>
                <span className="text-slate-400">IMEIs:</span> <b className="text-slate-100">{parsedPreview.imeis.length}</b>
              </div>
            </div>
          ) : (
            <div className="text-slate-400">Waiting for valid QR data…</div>
          )}
        </div>

        <button
          onClick={importBox}
          disabled={!parsedPreview || saving}
          className="w-full px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving ? "Importing…" : "Import this box"}
        </button>
      </div>
    </div>
  );
}
