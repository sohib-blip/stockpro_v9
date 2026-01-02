"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

type PreviewResp = any;
type ConfirmResp = any;

function parseImeis(text: string) {
  const digits = (text || "").match(/\d{14,17}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of digits) {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { ok: false, error: txt || "Invalid JSON response" };
  }
}

/** Extract IMEIs from an Excel file (all sheets, all cells) */
async function extractImeisFromExcel(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const found: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    // Convert to array of arrays
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any;
    for (const row of rows) {
      for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const s = String(cell);
        const matches = s.match(/\d{14,17}/g);
        if (matches?.length) found.push(...matches);
      }
    }
  }

  // unique
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of found) {
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  return out;
}

export default function OutboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<"manual" | "eod" | "history">("manual");

  // Manual scan
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResp | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Camera scan
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState("");

  // EOD Import (Excel → bulk IMEIs)
  const [eodFileName, setEodFileName] = useState("");
  const [eodText, setEodText] = useState(""); // raw IMEI list as text
  const eodImeis = useMemo(() => parseImeis(eodText), [eodText]);
  const [eodPreview, setEodPreview] = useState<any | null>(null);
  const [eodConfirmOpen, setEodConfirmOpen] = useState(false);

  // History
  const [events, setEvents] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [boxLocationMap, setBoxLocationMap] = useState<Record<string, string | null>>({});

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function refreshHistory() {
    setLoadingHistory(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/outbound/history?limit=120", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeJson(res);
      if (json?.ok) {
        const ev = json.events ?? [];
        setEvents(ev);

        // Try to enrich with box locations (optional)
        const boxIds = Array.from(
          new Set(
            ev
              .map((x: any) => x?.entity === "box" ? x?.entity_id : x?.payload?.box_id)
              .filter(Boolean)
          )
        );

        if (boxIds.length) {
          const { data, error } = await supabase
            .from("boxes")
            .select("box_id, location")
            .in("box_id", boxIds as string[]);

          if (!error && data) {
            const m: Record<string, string | null> = {};
            for (const r of data as any[]) m[r.box_id] = r.location ?? null;
            setBoxLocationMap(m);
          }
        }
      }
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doPreviewManual(payload?: string) {
    const value = (payload ?? raw).trim();
    if (!value || loadingPreview || loadingConfirm) return;

    setLoadingPreview(true);
    setPreview(null);
    setConfirm(null);

    try {
      const token = await getToken();
      if (!token) {
        setPreview({ ok: false, error: "You must be signed in." });
        return;
      }

      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qr: value }),
      });

      const json = await safeJson(res);
      setPreview(json);
    } catch (e: any) {
      setPreview({ ok: false, error: e?.message ?? "Preview error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doConfirmManual() {
    const value = raw.trim();
    if (!value || loadingConfirm || loadingPreview) return;

    setLoadingConfirm(true);
    setConfirm(null);

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Not signed in", message: "Go to Login." });
        return;
      }

      const res = await fetch("/api/outbound/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ raw: value, qr: value }),
      });

      const json = await safeJson(res);
      setConfirm(json);

      if (json?.ok) {
        toast({
          kind: "success",
          title: "Outbound completed",
          message: `${json.device ?? "-"} / ${json.box_no ?? "-"}`,
        });

        setRaw("");
        setPreview(null);
        setTimeout(() => inputRef.current?.focus(), 50);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      toast({ kind: "error", title: "Outbound failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
    }
  }

  // EOD preview/confirm = same backend endpoints, just bulk text
  async function doPreviewEod() {
    if (eodImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Your Excel must contain 14–17 digits IMEIs." });
      return;
    }
    setLoadingPreview(true);
    setEodPreview(null);

    try {
      const token = await getToken();
      if (!token) {
        setEodPreview({ ok: false, error: "You must be signed in." });
        return;
      }

      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qr: eodText.trim() }),
      });

      const json = await safeJson(res);
      setEodPreview(json);
    } catch (e: any) {
      setEodPreview({ ok: false, error: e?.message ?? "Preview error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doConfirmEod() {
    if (eodImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Import an EOD file first." });
      return;
    }

    setLoadingConfirm(true);
    setConfirm(null);

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Not signed in", message: "Go to Login." });
        return;
      }

      const res = await fetch("/api/outbound/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ raw: eodText.trim(), qr: eodText.trim() }),
      });

      const json = await safeJson(res);
      setConfirm(json);

      if (json?.ok) {
        toast({
          kind: "success",
          title: "EOD dispatch applied",
          message: `${json.items_out ?? json.total_out ?? eodImeis.length} IMEI processed`,
        });
        setEodFileName("");
        setEodText("");
        setEodPreview(null);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "EOD failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      toast({ kind: "error", title: "EOD failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
      setEodConfirmOpen(false);
    }
  }

  async function onPickEodFile(file: File | null) {
    if (!file) return;
    try {
      setEodFileName(file.name);
      setEodPreview(null);

      const imeis = await extractImeisFromExcel(file);
      if (imeis.length === 0) {
        toast({ kind: "error", title: "No IMEIs found", message: "Excel parsed but no IMEI detected." });
        setEodText("");
        return;
      }

      setEodText(imeis.join("\n"));
      toast({ kind: "success", title: "Excel loaded", message: `${imeis.length} IMEI found` });
    } catch (e: any) {
      toast({ kind: "error", title: "Excel error", message: e?.message ?? "Failed to read Excel" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Outbound</div>
          <h2 className="text-xl font-semibold">Dispatch & Outbound</h2>
          <p className="text-sm text-slate-400 mt-1">
            Manual outbound + End-of-day Excel import + full history (user/device/etage).
          </p>
        </div>

        <button
          onClick={refreshHistory}
          disabled={loadingHistory}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loadingHistory ? "Refreshing…" : "Refresh history"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          🔎 Manual
        </TabButton>
        <TabButton active={tab === "eod"} onClick={() => setTab("eod")}>
          📄 EOD Import
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          🕘 History
        </TabButton>
      </div>

      {/* MANUAL */}
      {tab === "manual" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Manual outbound</div>
              <div className="text-xs text-slate-500">Scan USB / paste QR / camera. Preview then confirm.</div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setCamError("");
                  setCamOpen(true);
                }}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Scan camera
              </button>

              <button
                onClick={() => doPreviewManual()}
                disabled={loadingPreview || loadingConfirm || !raw.trim()}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? "Previewing…" : "Preview"}
              </button>

              <button
                onClick={() => setConfirmOpen(true)}
                disabled={loadingConfirm || loadingPreview || !raw.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {loadingConfirm ? "Confirming…" : "Confirm"}
              </button>

              <button
                onClick={() => {
                  setRaw("");
                  setPreview(null);
                  setConfirm(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <input
                ref={inputRef}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doPreviewManual();
                  }
                }}
                placeholder="Scan/paste QR here…"
                className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
              />
              <div className="text-xs text-slate-500 mt-2">Tip: press Enter to preview.</div>

              {camError ? (
                <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
                  {camError}
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <div className="text-xs text-slate-500 mb-2">Preview</div>

                {!preview ? (
                  <div className="text-sm text-slate-400">No preview yet.</div>
                ) : preview.ok ? (
                  <div className="space-y-2">
                    <div className="text-sm">
                      <span className="text-slate-400">Device:</span>{" "}
                      <span className="font-semibold">{preview.device ?? "-"}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-slate-400">Box:</span>{" "}
                      <span className="font-semibold">{preview.box_no ?? "-"}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-slate-400">Mode:</span>{" "}
                      <span className="font-semibold">{preview.mode ?? "-"}</span>
                    </div>
                    {typeof preview.items_out !== "undefined" ? (
                      <div className="text-sm">
                        <span className="text-slate-400">Will remove:</span>{" "}
                        <span className="font-semibold">{preview.items_out}</span>
                      </div>
                    ) : null}
                    {preview.imeis?.length ? (
                      <div className="mt-2">
                        <div className="text-xs text-slate-500 mb-1">IMEIs</div>
                        <div className="max-h-40 overflow-auto rounded-lg border border-slate-800 p-2 text-xs text-slate-200">
                          {preview.imeis.map((i: string) => (
                            <div key={i} className="border-b border-slate-900 py-0.5">
                              {i}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-rose-200">{preview.error || "Preview failed"}</div>
                )}
              </div>

              {confirm && !confirm.ok ? (
                <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
                  {confirm.error || "Outbound failed"}
                </div>
              ) : null}
            </div>
          </div>

          <ConfirmDialog
            open={confirmOpen}
            title="Confirm outbound"
            message="This will remove the scanned box/items from stock."
            confirmText={loadingConfirm ? "Working…" : "Confirm"}
            cancelText="Cancel"
            onCancel={() => setConfirmOpen(false)}
            onConfirm={async () => {
              setConfirmOpen(false);
              await doConfirmManual();
            }}
          />

          {camOpen ? (
            <QrCameraModal
              onClose={() => setCamOpen(false)}
              onResult={(value) => {
                setRaw(value);
                setCamOpen(false);
                setTimeout(() => void doPreviewManual(value), 50);
              }}
              setError={(msg) => setCamError(msg)}
            />
          ) : null}
        </div>
      )}

      {/* EOD IMPORT */}
      {tab === "eod" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">End of day dispatch (Excel)</div>
              <div className="text-xs text-slate-500">
                Import your EOD report and remove all dispatched IMEIs (daily/weekly).
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={doPreviewEod}
                disabled={loadingPreview || loadingConfirm || eodImeis.length === 0}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? "Previewing…" : "Preview"}
              </button>

              <button
                onClick={() => setEodConfirmOpen(true)}
                disabled={loadingConfirm || loadingPreview || eodImeis.length === 0}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {loadingConfirm ? "Confirming…" : "Commit (remove stock)"}
              </button>

              <button
                onClick={() => {
                  setEodFileName("");
                  setEodText("");
                  setEodPreview(null);
                }}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500 mb-2">Upload report</div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => onPickEodFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <div className="text-xs text-slate-500 mt-2">
              File: <span className="text-slate-300">{eodFileName || "-"}</span> • IMEIs detected:{" "}
              <span className="font-semibold text-slate-100">{eodImeis.length}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500 mb-2">IMEI list (auto from Excel)</div>
              <textarea
                value={eodText}
                onChange={(e) => setEodText(e.target.value)}
                placeholder="IMEIs will appear here…"
                className="w-full min-h-[220px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
              />
              <div className="text-xs text-slate-500 mt-2">
                You can paste extra IMEIs here too (one per line).
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs text-slate-500 mb-2">Preview</div>

              {!eodPreview ? (
                <div className="text-sm text-slate-400">No preview yet.</div>
              ) : eodPreview.ok ? (
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-slate-400">Mode:</span>{" "}
                    <span className="font-semibold">{eodPreview.mode ?? "bulk"}</span>
                  </div>

                  <div>
                    <span className="text-slate-400">Will remove:</span>{" "}
                    <span className="font-semibold">{eodPreview.items_out ?? eodImeis.length}</span>
                  </div>

                  {!!eodPreview.not_found?.length && (
                    <div className="mt-2">
                      <div className="text-xs text-rose-200 mb-1">
                        Not found ({eodPreview.not_found.length})
                      </div>
                      <div className="max-h-40 overflow-auto rounded-lg border border-rose-900/40 p-2 text-xs text-rose-100">
                        {eodPreview.not_found.slice(0, 50).map((i: string) => (
                          <div key={i} className="border-b border-slate-900 py-0.5">
                            {i}
                          </div>
                        ))}
                        {eodPreview.not_found.length > 50 && (
                          <div className="text-slate-400 mt-1">… +{eodPreview.not_found.length - 50}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-rose-200">{eodPreview.error || "Preview failed"}</div>
              )}
            </div>
          </div>

          <ConfirmDialog
            open={eodConfirmOpen}
            title="Confirm EOD dispatch"
            message={`This will remove ${eodImeis.length} IMEI(s) from stock.`}
            confirmText={loadingConfirm ? "Working…" : "Confirm"}
            cancelText="Cancel"
            onCancel={() => setEodConfirmOpen(false)}
            onConfirm={async () => {
              setEodConfirmOpen(false);
              await doConfirmEod();
            }}
          />
        </div>
      )}

      {/* HISTORY */}
      {tab === "history" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Outbound history</div>
              <div className="text-xs text-slate-500">Includes user + device + box + etage (if available)</div>
            </div>
            <button
              onClick={refreshHistory}
              disabled={loadingHistory}
              className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="mt-3 overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Device</th>
                  <th className="p-2 text-left">Box</th>
                  <th className="p-2 text-left">Etage</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e: any, idx: number) => {
                  const p = e.payload || {};
                  const boxId = (e.entity === "box" ? e.entity_id : p.box_id) as string | undefined;
                  const loc = boxId ? boxLocationMap[boxId] : null;

                  return (
                    <tr key={idx} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800 text-slate-300">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="p-2 border-b border-slate-800">{p.device ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800">{p.box_no ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800">{loc ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{p.qty ?? p.items_out ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-slate-400">
                        {e.created_by_email ?? e.created_by_name ?? "-"}
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-3 text-sm text-slate-400">
                      No events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-slate-500 mt-2">
            Note: “Etage” is the current box location (fetched from boxes.location).
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl px-4 py-2 text-sm font-semibold border",
        active
          ? "bg-slate-900 border-slate-700 text-white"
          : "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** Camera QR modal */
function QrCameraModal({
  onClose,
  onResult,
  setError,
}: {
  onClose: () => void;
  onResult: (value: string) => void;
  setError: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera not supported on this device/browser.");
          return;
        }

        const BD = (window as any).BarcodeDetector;
        if (!BD) {
          setError("BarcodeDetector not available. Use Chrome/Edge or scan with USB scanner.");
          return;
        }

        const detector = new BD({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) {
              const rawValue = (codes[0]?.rawValue || "").trim();
              if (rawValue) {
                onResult(rawValue);
                return;
              }
            }
          } catch {
            // ignore frame errors
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.message || "Camera failed to start.");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, setError]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Scan QR (camera)</div>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-3 rounded-xl overflow-hidden border border-slate-800 bg-black">
          <video ref={videoRef} className="w-full h-[360px] object-cover" />
        </div>

        <div className="mt-3 text-xs text-slate-400">
          Tip: if camera scan doesn’t work, use the USB scanner input field.
        </div>
      </div>
    </div>
  );
}
