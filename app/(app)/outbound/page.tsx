"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type ApiResp = { ok: boolean; error?: string; [k: string]: any };

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
        active
          ? "bg-slate-800 border-slate-700 text-slate-100"
          : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function cleanImeisFromText(text: string) {
  const raw = String(text || "");
  const parts = raw.split(/[\s,;]+/g).map((x) => x.trim()).filter(Boolean);
  const imeis = parts.map((x) => x.replace(/\D/g, "")).filter((x) => /^\d{14,17}$/.test(x));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of imeis) {
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

  const [tab, setTab] = useState<"work" | "history">("work");

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<any>(null);

  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const [loadingCommit, setLoadingCommit] = useState(false);
  const [commitRes, setCommitRes] = useState<any>(null);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  function resetAll() {
    setPreview(null);
    setCommitRes(null);
    setExcluded(new Set());
  }

  function removeImei(imei: string) {
    setExcluded((prev) => new Set([...Array.from(prev), imei]));
  }

  function restoreAllImeis() {
    setExcluded(new Set());
  }

  async function runPreview() {
    try {
      setLoadingPreview(true);
      setPreview(null);
      setCommitRes(null);
      setExcluded(new Set());

      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      let res: Response;

      if (file) {
        const fd = new FormData();
        fd.append("file", file);

        res = await fetch("/api/outbound/preview", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } else {
        const imeis = cleanImeisFromText(text);
        if (imeis.length === 0) {
          toast({ kind: "error", title: "Preview", message: "Colle des IMEI valides OU choisis un Excel." });
          return;
        }

        res = await fetch("/api/outbound/preview", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ imeis }),
        });
      }

      const json = (await res.json().catch(() => null)) as ApiResp | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Preview failed");

      setPreview(json);
      toast({ kind: "success", title: "Preview ready" });
    } catch (e: any) {
      toast({ kind: "error", title: "Preview", message: e?.message || "Error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function runCommit() {
    try {
      if (!preview?.ok) {
        toast({ kind: "error", title: "Commit", message: "Fais un preview d’abord." });
        return;
      }

      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      setLoadingCommit(true);
      setCommitRes(null);

      const excludedArr = Array.from(excluded);

      // commit via JSON basé sur preview.will_go_out (plus safe pour le "remove manuel")
      const finalImeis: string[] = Array.isArray(preview?.will_go_out) ? preview.will_go_out : [];
      const toCommit = excludedArr.length ? finalImeis.filter((x) => !excluded.has(x)) : finalImeis;

      if (toCommit.length === 0) {
        toast({ kind: "error", title: "Commit", message: "Rien à sortir (tout est exclu)." });
        return;
      }

      const res = await fetch("/api/outbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          imeis: toCommit,
          exclude_imeis: [],
          source: preview?.source ?? { type: "manual" },
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiResp | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Commit failed");

      setCommitRes(json);
      toast({ kind: "success", title: "Stock updated (OUT)" });
    } catch (e: any) {
      toast({ kind: "error", title: "Commit", message: e?.message || "Error" });
    } finally {
      setLoadingCommit(false);
    }
  }

  async function loadHistory() {
    try {
      setHistoryLoading(true);
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      const res = await fetch("/api/outbound/history?limit=80", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = (await res.json().catch(() => null)) as ApiResp | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error || "History failed");

      setHistory(Array.isArray(json.events) ? json.events : []);
    } catch (e: any) {
      toast({ kind: "error", title: "History", message: e?.message || "Error" });
    } finally {
      setHistoryLoading(false);
    }
  }

  const imeiCountText = cleanImeisFromText(text).length;
  const willGoOut: string[] = Array.isArray(preview?.will_go_out) ? preview.will_go_out : [];
  const willGoOutAfter = willGoOut.filter((x) => !excluded.has(x));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h1 className="text-xl font-semibold">Preview → Commit (propre)</h1>
        <p className="text-sm text-slate-400 mt-1">
          Tu upload un Excel OU tu colles des IMEI, tu vois ce qui va sortir, tu peux retirer des IMEI, puis commit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "work"} onClick={() => setTab("work")}>
          Work
        </TabButton>
        <TabButton
          active={tab === "history"}
          onClick={() => {
            setTab("history");
            loadHistory();
          }}
        >
          History
        </TabButton>
      </div>

      {tab === "work" ? (
        <>
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
            <div className="text-sm font-semibold">Input</div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="text-xs text-slate-500">Option A — Coller des IMEI</div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  placeholder={`Colle ici…
355123456789012
355123456789013`}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <div className="text-xs text-slate-400">
                  IMEIs détectés (texte): <span className="font-semibold text-slate-200">{imeiCountText}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-slate-500">Option B — Upload Excel</div>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                <div className="text-xs text-slate-500">
                  Si tu mets un fichier, on ignore le texte (c’est volontaire).
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={runPreview}
                disabled={loadingPreview}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingPreview ? "Preview…" : "Preview"}
              </button>

              <button
                onClick={runCommit}
                disabled={loadingCommit || !preview?.ok}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {loadingCommit ? "Committing…" : "Commit OUT"}
              </button>

              <button
                onClick={() => {
                  setText("");
                  setFile(null);
                  resetAll();
                }}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
              >
                Clear
              </button>
            </div>
          </div>

          {preview?.ok ? (
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Preview</div>
                  <div className="text-xs text-slate-500">
                    Source: {preview?.source?.type} {preview?.source?.filename ? `(${preview.source.filename})` : ""}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={restoreAllImeis}
                    className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                  >
                    Restore all
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="IMEIs total" value={Number(preview.imeis_total ?? 0)} />
                <Stat label="Found in DB" value={Number(preview.imeis_found ?? 0)} />
                <Stat label="Missing" value={Number(preview.imeis_missing_count ?? 0)} />
                <Stat label="Already OUT" value={Number(preview.imeis_already_out_count ?? 0)} />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
                <Stat label="Will go OUT" value={Number(preview.imeis_will_go_out_count ?? 0)} />
                <Stat label="Will go OUT (after removals)" value={willGoOutAfter.length} />
              </div>

              {/* boxes */}
              <div className="overflow-auto">
                <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                  <thead className="bg-slate-950/50">
                    <tr>
                      <th className="p-2 text-left border-b border-slate-800">Device</th>
                      <th className="p-2 text-left border-b border-slate-800">Box</th>
                      <th className="p-2 text-left border-b border-slate-800">Location</th>
                      <th className="p-2 text-right border-b border-slate-800">IN before</th>
                      <th className="p-2 text-right border-b border-slate-800">OUT now</th>
                      <th className="p-2 text-right border-b border-slate-800">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.boxes || []).map((b: any) => (
                      <tr key={b.box_id} className="hover:bg-slate-950/50">
                        <td className="p-2 border-b border-slate-800">{b.device}</td>
                        <td className="p-2 border-b border-slate-800">{b.box_no}</td>
                        <td className="p-2 border-b border-slate-800">{b.location}</td>
                        <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.in_before}</td>
                        <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.out_now}</td>
                        <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.remaining_after}</td>
                      </tr>
                    ))}
                    {(preview.boxes || []).length === 0 ? (
                      <tr>
                        <td className="p-3 text-slate-400" colSpan={6}>
                          Aucun IMEI IN trouvé (rien à sortir).
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* removable list */}
              <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 space-y-2">
                <div className="text-sm font-semibold">IMEIs qui vont sortir (tu peux retirer)</div>
                <div className="text-xs text-slate-500">
                  Clique “Remove” pour exclure un IMEI du commit.
                </div>

                <div className="max-h-[260px] overflow-auto mt-2 space-y-2">
                  {willGoOut.length === 0 ? (
                    <div className="text-xs text-slate-400">—</div>
                  ) : (
                    willGoOut.map((i) => {
                      const removed = excluded.has(i);
                      return (
                        <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
                          <div className={`text-xs font-mono ${removed ? "line-through text-slate-500" : "text-slate-100"}`}>
                            {i}
                          </div>
                          <button
                            onClick={() => removeImei(i)}
                            disabled={removed}
                            className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-1 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {commitRes ? <ResultPanel title="Commit result" data={commitRes} /> : null}
            </div>
          ) : null}

          {/* debug preview json if needed */}
          {preview ? <ResultPanel title="Preview JSON" data={preview} /> : null}
        </>
      ) : (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">History</div>
              <div className="text-xs text-slate-500">audit_events (action = STOCK_OUT)</div>
            </div>

            <button
              onClick={loadHistory}
              disabled={historyLoading}
              className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {historyLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="text-xs text-slate-400">Aucun event.</div>
            ) : (
              history.map((e, idx) => (
                <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="text-xs text-slate-300 font-semibold">
                    {String(e.action || "")} · {String(e.created_at || "")}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    boxes: {e?.payload?.affected_boxes ?? "?"} · committed: {e?.payload?.committed_imeis ?? "?"}
                  </div>
                </div>
              ))
            )}
          </div>

          <ResultPanel title="History JSON" data={history} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function ResultPanel({ title, data }: { title: string; data: any }) {
  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4">
      <div className="text-sm font-semibold">{title}</div>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-200">
        {data ? JSON.stringify(data, null, 2) : "—"}
      </pre>
    </div>
  );
}