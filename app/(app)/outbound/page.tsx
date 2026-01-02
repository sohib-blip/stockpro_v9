"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function OutboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<"scan" | "bulk" | "history">("scan");

  // Scan (single QR / box / imei)
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResp | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Camera
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState<string>("");

  // Bulk/manual list
  const [bulkText, setBulkText] = useState("");
  const bulkImeis = useMemo(() => parseImeis(bulkText), [bulkText]);
  const [bulkPreview, setBulkPreview] = useState<any | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // History
  const [events, setEvents] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function getUserFirstName() {
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email || "";
    return email ? email.split("@")[0] : "";
  }

  async function refreshHistory() {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/outbound/history?limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeJson(res);
      if (json?.ok) setEvents(json.events ?? []);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function doPreview(payload?: string) {
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

  async function doConfirmNow() {
    const value = raw.trim();
    if (!value || loadingConfirm || loadingPreview) return;

    setLoadingConfirm(true);
    setConfirm(null);

    try {
      const token = await getToken();
      if (!token) {
        setConfirm({ ok: false, error: "Not signed in. Go to Login." });
        toast({ kind: "error", title: "Not signed in", message: "Go to Login." });
        return;
      }

      // ✅ On garde ton endpoint existant
      const res = await fetch("/api/outbound/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // backend accepte raw/qr (on envoie les deux)
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

        // optimistic history
        const who = await getUserFirstName();
        setEvents((prev) => [
          {
            created_at: new Date().toISOString(),
            entity: json.mode === "box" ? "box" : "item",
            entity_id: json.mode === "imei" ? json.imei : json.box_id,
            payload: { device: json.device, box_no: json.box_no, qty: json.items_out ?? 1 },
            created_by_name: who || null,
          },
          ...(prev ?? []),
        ]);

        setRaw("");
        setPreview(null);
        setTimeout(() => inputRef.current?.focus(), 50);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      setConfirm({ ok: false, error: e?.message ?? "Confirm error" });
      toast({ kind: "error", title: "Outbound failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
    }
  }

  async function doBulkPreview() {
    const value = bulkText.trim();
    if (!value || loadingPreview || loadingConfirm) return;
    if (bulkImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Paste one IMEI per line (14–17 digits)." });
      return;
    }

    setLoadingPreview(true);
    setBulkPreview(null);

    try {
      const token = await getToken();
      if (!token) {
        setBulkPreview({ ok: false, error: "You must be signed in." });
        return;
      }

      // On réutilise preview outbound avec qr = bulkText
      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qr: value }),
      });

      const json = await safeJson(res);
      setBulkPreview(json);
    } catch (e: any) {
      setBulkPreview({ ok: false, error: e?.message ?? "Preview error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doConfirmBulkNow() {
    const value = bulkText.trim();
    if (!value || loadingConfirm || loadingPreview) return;
    if (bulkImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Paste one IMEI per line (14–17 digits)." });
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
        body: JSON.stringify({ raw: value, qr: value }),
      });

      const json = await safeJson(res);
      setConfirm(json);

      if (json?.ok) {
        const total = json?.total_out ?? json?.items_out ?? 0;
        toast({ kind: "success", title: "Outbound completed", message: total ? `${total} IMEI removed` : "Done" });

        const who = await getUserFirstName();
        setEvents((prev) => [
          {
            created_at: new Date().toISOString(),
            entity: "bulk",
            entity_id: "bulk",
            payload: { total_out: total, boxes: json?.boxes ?? [] },
            created_by_name: who || null,
          },
          ...(prev ?? []),
        ]);

        setBulkText("");
        setBulkPreview(null);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      toast({ kind: "error", title: "Outbound failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
      setBulkConfirmOpen(false);
    }
  }

  function resetScan() {
    setRaw("");
    setPreview(null);
    setConfirm(null);
    setCamError("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Outbound</div>
          <h2 className="text-xl font-semibold">Outbound Scan</h2>
          <p className="text-sm text-slate-400 mt-1">Scan a QR (box / imei) to remove from stock.</p>
        </div>

        <button
          onClick={refreshHistory}
          disabled={loadingHistory}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loadingHistory ? "Refreshing…" : "Refresh history"}
        </button>
      </div>

      {/* Tabs (same vibe as inbound) */}
      <div className="flex gap-2">
        <TabButton active={tab === "scan"} onClick={() => setTab("scan")}>
          📷 Scan QR
        </TabButton>
        <TabButton active={tab === "bulk"} onClick={() => setTab("bulk")}>
          🧾 Manual list
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          🕘 History
        </TabButton>
      </div>

      {tab === "scan" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Scanner</div>
              <div className="text-xs text-slate-500">Use USB scanner, paste QR content, or camera.</div>
            </div>

            <div className="flex gap-2">
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
                onClick={() => doPreview()}
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
                onClick={resetScan}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Input (USB scanner like inbound) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <input
                ref={inputRef}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void doPreview();
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
    await doConfirmNow();
  }}
/>


          {camOpen ? (
            <QrCameraModal
              onClose={() => setCamOpen(false)}
              onResult={(value) => {
                setRaw(value);
                setCamOpen(false);
                setTimeout(() => void doPreview(value), 50);
              }}
              setError={(msg) => setCamError(msg)}
            />
          ) : null}
        </div>
      )}

      {tab === "bulk" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Manual list</div>
              <div className="text-xs text-slate-500">Paste IMEIs (one per line). Preview then confirm.</div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={doBulkPreview}
                disabled={loadingPreview || loadingConfirm || bulkImeis.length === 0}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? "Previewing…" : "Preview"}
              </button>

              <button
                onClick={() => setBulkConfirmOpen(true)}
                disabled={loadingConfirm || loadingPreview || bulkImeis.length === 0}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                Confirm
              </button>

              <button
                onClick={() => {
                  setBulkText("");
                  setBulkPreview(null);
                }}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="Paste IMEIs here (one per line)…"
            className="w-full min-h-[160px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />

          <div className="text-xs text-slate-500">Detected IMEIs: {bulkImeis.length}</div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500 mb-2">Preview</div>

            {!bulkPreview ? (
              <div className="text-sm text-slate-400">No preview yet.</div>
            ) : bulkPreview.ok ? (
              <div className="text-sm text-slate-200">
                Ready. Items to remove: <span className="font-semibold">{bulkPreview.items_out ?? bulkImeis.length}</span>
              </div>
            ) : (
              <div className="text-sm text-rose-200">{bulkPreview.error || "Preview failed"}</div>
            )}
          </div>

<ConfirmDialog
  open={bulkConfirmOpen}
  title="Confirm bulk outbound"
  message={`This will remove ${bulkImeis.length} IMEI(s) from stock.`}
  confirmText={loadingConfirm ? "Working…" : "Confirm"}
  cancelText="Cancel"
  onCancel={() => setBulkConfirmOpen(false)}
  onConfirm={async () => {
    setBulkConfirmOpen(false);
    await doConfirmBulkNow();
  }}
/>

        </div>
      )}

      {tab === "history" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Outbound history</div>
              <div className="text-xs text-slate-500">Last 100 events</div>
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
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">By</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, idx) => {
                  const p = e.payload || {};
                  return (
                    <tr key={idx} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800 text-slate-300">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="p-2 border-b border-slate-800">{p.device ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800">{p.box_no ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{p.qty ?? p.total_out ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-slate-400">{e.created_by_name ?? "-"}</td>
                    </tr>
                  );
                })}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-sm text-slate-400">
                      No events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-xl px-4 py-2 text-sm font-semibold border",
        active ? "bg-slate-900 border-slate-700 text-white" : "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

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
