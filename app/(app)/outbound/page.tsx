"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import ConfirmDialog from "@/components/ConfirmDialog";

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

async function extractImeisFromExcel(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const found: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
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

  const [tab, setTab] = useState<"manual" | "eod" | "history">("manual");

  // manual
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [raw, setRaw] = useState("");
  const [manualPreview, setManualPreview] = useState<any | null>(null);
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);

  // eod
  const [eodFileName, setEodFileName] = useState("");
  const [eodText, setEodText] = useState("");
  const eodImeis = useMemo(() => parseImeis(eodText), [eodText]);
  const [eodPreview, setEodPreview] = useState<any | null>(null);
  const [eodConfirmOpen, setEodConfirmOpen] = useState(false);
  const [clearLocWhenEmpty, setClearLocWhenEmpty] = useState(false);

  // history
  const [events, setEvents] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
      if (json?.ok) setEvents(json.events ?? []);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MANUAL preview uses your existing endpoint
  async function doPreviewManual() {
    const value = raw.trim();
    if (!value) return;

    setLoadingPreview(true);
    setManualPreview(null);

    try {
      const token = await getToken();
      if (!token) {
        setManualPreview({ ok: false, error: "Not signed in." });
        return;
      }

      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qr: value }),
      });
      setManualPreview(await safeJson(res));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doConfirmManual() {
    const value = raw.trim();
    if (!value) return;

    setLoadingConfirm(true);
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
      if (json?.ok) {
        toast({ kind: "success", title: "Outbound OK", message: "Stock updated." });
        setRaw("");
        setManualPreview(null);
        setTimeout(() => inputRef.current?.focus(), 50);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } finally {
      setLoadingConfirm(false);
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

  // EOD preview uses the NEW endpoint
  async function doPreviewEod() {
    if (eodImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs", message: "Import Excel first." });
      return;
    }

    setLoadingPreview(true);
    setEodPreview(null);

    try {
      const res = await fetch("/api/outbound/eod/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imeis: eodImeis,
          clear_location_when_empty: clearLocWhenEmpty,
        }),
      });

      setEodPreview(await safeJson(res));
    } finally {
      setLoadingPreview(false);
    }
  }

  // EOD commit uses the NEW endpoint
  async function doConfirmEod() {
    if (eodImeis.length === 0) return;

    setLoadingConfirm(true);
    try {
      const res = await fetch("/api/outbound/eod/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imeis: eodImeis,
          clear_location_when_empty: clearLocWhenEmpty,
        }),
      });

      const json = await safeJson(res);

      if (json?.ok) {
        toast({
          kind: "success",
          title: "EOD applied",
          message: `${json.removed_from_stock} IMEI OUT • ${json.emptied_boxes} boxes emptied`,
        });
        setEodFileName("");
        setEodText("");
        setEodPreview(null);
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "EOD failed", message: json?.error || "Unknown error" });
      }
    } finally {
      setLoadingConfirm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Dispatch & Outbound</h2>
        <p className="text-sm text-slate-400 mt-1">
          Manual outbound + EOD Excel (IMEI only) → auto box lookup → empty box = OUT (optional location null).
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          Manual
        </TabButton>
        <TabButton active={tab === "eod"} onClick={() => setTab("eod")}>
          EOD Import
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History
        </TabButton>
      </div>

      {/* MANUAL */}
      {tab === "manual" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold">Manual outbound</div>
              <div className="text-xs text-slate-500">Scan/paste QR then Preview → Confirm.</div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={doPreviewManual}
                disabled={loadingPreview || loadingConfirm || !raw.trim()}
                className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? "Previewing…" : "Preview"}
              </button>
              <button
                onClick={() => setManualConfirmOpen(true)}
                disabled={loadingConfirm || loadingPreview || !raw.trim()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {loadingConfirm ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>

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

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500 mb-2">Preview</div>
            {!manualPreview ? (
              <div className="text-sm text-slate-400">No preview yet.</div>
            ) : manualPreview.ok ? (
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-slate-400">Device:</span> <b>{manualPreview.device ?? "-"}</b>
                </div>
                <div>
                  <span className="text-slate-400">Box:</span> <b>{manualPreview.box_no ?? "-"}</b>
                </div>
                <div>
                  <span className="text-slate-400">Will remove:</span>{" "}
                  <b>{manualPreview.items_out ?? "-"}</b>
                </div>
              </div>
            ) : (
              <div className="text-sm text-rose-200">{manualPreview.error || "Preview failed"}</div>
            )}
          </div>

          <ConfirmDialog
            open={manualConfirmOpen}
            title="Confirm outbound"
            message="This will remove the scanned box/items from stock."
            confirmText={loadingConfirm ? "Working…" : "Confirm"}
            cancelText="Cancel"
            onCancel={() => setManualConfirmOpen(false)}
            onConfirm={async () => {
              setManualConfirmOpen(false);
              await doConfirmManual();
            }}
          />
        </div>
      )}

      {/* EOD */}
      {tab === "eod" && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold">EOD Excel import (IMEI only)</div>
              <div className="text-xs text-slate-500">
                Upload → extract IMEIs → Preview → Commit. Boxes are detected automatically via items.box_id.
              </div>
            </div>
            <div className="flex gap-2">
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
                {loadingConfirm ? "Working…" : "Commit"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500 mb-2">Upload EOD report</div>
            <input type="file" accept=".xlsx,.xls" onChange={(e) => onPickEodFile(e.target.files?.[0] ?? null)} />
            <div className="text-xs text-slate-500 mt-2">
              File: <span className="text-slate-300">{eodFileName || "-"}</span> • IMEIs:{" "}
              <b className="text-slate-100">{eodImeis.length}</b>
            </div>

            <div className="mt-3">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={clearLocWhenEmpty}
                  onChange={(e) => setClearLocWhenEmpty(e.target.checked)}
                />
                Clear box location when empty (location = null)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500 mb-2">IMEI list</div>
              <textarea
                value={eodText}
                onChange={(e) => setEodText(e.target.value)}
                className="w-full min-h-[240px] border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
              />
              <div className="text-xs text-slate-500 mt-2">Tu peux aussi coller des IMEI ici (1 par ligne).</div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs text-slate-500 mb-2">Preview result</div>

              {!eodPreview ? (
                <div className="text-sm text-slate-400">No preview yet.</div>
              ) : eodPreview.ok ? (
                <div className="text-sm space-y-2">
                  <div>Total IMEI: <b>{eodPreview.total_imeis_in_file}</b></div>
                  <div>Will remove: <b>{eodPreview.will_remove_from_stock}</b></div>
                  <div>Already OUT: <b>{eodPreview.already_out}</b></div>
                  <div>Not found: <b>{eodPreview.not_found}</b></div>
                  <div>Affected boxes: <b>{eodPreview.affected_boxes}</b></div>
                  <div>Boxes emptied: <b>{eodPreview.boxes_will_be_emptied}</b></div>

                  {Array.isArray(eodPreview.boxes) && eodPreview.boxes.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-slate-500 mb-1">Boxes impactées</div>
                      <div className="max-h-56 overflow-auto border border-slate-800 rounded-lg">
                        {eodPreview.boxes.map((b: any) => (
                          <div key={b.box_id} className="p-2 border-b border-slate-800 text-xs">
                            <div className="flex justify-between gap-2">
                              <div>
                                <b>{b.device ?? "-"}</b> • {b.master_box_no ?? b.box_no ?? "-"} • loc:{" "}
                                {b.location ?? "-"}
                              </div>
                              <div className={b.will_be_emptied ? "text-rose-300" : "text-slate-300"}>
                                {b.will_remove}/{b.current_in} → remain {b.will_remain}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!!eodPreview.lists?.not_found?.length && (
                    <div className="mt-3">
                      <div className="text-xs text-rose-200 mb-1">Not found (first 200)</div>
                      <div className="max-h-28 overflow-auto border border-rose-900/40 rounded-lg p-2 text-xs text-rose-100">
                        {eodPreview.lists.not_found.map((x: string) => (
                          <div key={x}>{x}</div>
                        ))}
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
            title="Confirm EOD commit"
            message={`This will remove ${eodImeis.length} IMEI(s) from stock. Empty boxes will be set to OUT.${clearLocWhenEmpty ? " Also sets location = null." : ""}`}
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
              <div className="text-xs text-slate-500">Uses your existing /api/outbound/history</div>
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
                {events.map((e: any, idx: number) => {
                  const p = e.payload || {};
                  return (
                    <tr key={idx} className="hover:bg-slate-950/50">
                      <td className="p-2 border-b border-slate-800 text-slate-300">
                        {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                      </td>
                      <td className="p-2 border-b border-slate-800">{p.device ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800">{p.box_no ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-right">{p.qty ?? p.items_out ?? "-"}</td>
                      <td className="p-2 border-b border-slate-800 text-slate-400">
                        {e.created_by_email ?? e.created_by_name ?? "-"}
                      </td>
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
