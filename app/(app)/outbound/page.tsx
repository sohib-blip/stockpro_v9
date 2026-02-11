"use client";

import React, { useMemo, useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { LOCATIONS } from "@/lib/device";

type ApiResp = { ok: boolean; error?: string; [k: string]: any };

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
  const parts = raw
    .split(/[\s,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const imeis = parts
    .map((x) => x.replace(/\D/g, ""))
    .filter((x) => /^\d{14,17}$/.test(x));

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

export default function OutboundUnifiedPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [tab, setTab] = useState<"outbound" | "movements" | "eod">("outbound");

  // scan input
  const [scanText, setScanText] = useState("");

  // outbound
  const [outLoading, setOutLoading] = useState(false);
  const [outResult, setOutResult] = useState<any>(null);

  // movements
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveResult, setMoveResult] = useState<any>(null);
  const [toLocation, setToLocation] =
    useState<(typeof LOCATIONS)[number]>("00");

  // end of day
  const [eodFile, setEodFile] = useState<File | null>(null);
  const [eodLoading, setEodLoading] = useState(false);
  const [eodPreview, setEodPreview] = useState<any>(null);
  const [eodCommitLoading, setEodCommitLoading] = useState(false);
  const [eodCommitResult, setEodCommitResult] = useState<any>(null);

  // ✅ selection manuelle d'IMEI (tu peux enlever avant commit)
  const [eodSelectedImeis, setEodSelectedImeis] = useState<Set<string>>(
    new Set()
  );
  const [eodImeiSearch, setEodImeiSearch] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function runOutbound() {
    const imeis = cleanImeisFromText(scanText);
    if (imeis.length === 0) {
      toast({
        kind: "error",
        title: "Scan un IMEI (ou colle plusieurs IMEIs)",
      });
      return;
    }

    setOutLoading(true);
    setOutResult(null);

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      const res = await fetch("/api/outbound/scan", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imei: imeis[0], imeis }),
      });

      const json = (await res.json()) as ApiResp;

      if (!res.ok || !json.ok) {
        toast({
          kind: "error",
          title: "Outbound failed",
          message: json.error || "Error",
        });
        return;
      }

      setOutResult(json);
      toast({ kind: "success", title: "Outbound OK" });
    } catch (e: any) {
      toast({
        kind: "error",
        title: "Outbound failed",
        message: e?.message || "Error",
      });
    } finally {
      setOutLoading(false);
    }
  }

  async function runMovement() {
    const imeis = cleanImeisFromText(scanText);
    if (imeis.length === 0) {
      toast({
        kind: "error",
        title: "Scan un IMEI (ou colle plusieurs IMEIs)",
      });
      return;
    }

    setMoveLoading(true);
    setMoveResult(null);

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      const res = await fetch("/api/movements/box", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imei: imeis[0], imeis, to_location: toLocation }),
      });

      const json = (await res.json()) as ApiResp;

      if (!res.ok || !json.ok) {
        toast({
          kind: "error",
          title: "Movement failed",
          message: json.error || "Error",
        });
        return;
      }

      setMoveResult(json);
      toast({ kind: "success", title: `Déplacé vers ${toLocation}` });
    } catch (e: any) {
      toast({
        kind: "error",
        title: "Movement failed",
        message: e?.message || "Error",
      });
    } finally {
      setMoveLoading(false);
    }
  }

  function buildSelectedFromPreview(preview: any) {
    const boxes = Array.isArray(preview?.boxes) ? preview.boxes : [];
    const imeis: string[] = [];
    for (const b of boxes) {
      const list = Array.isArray(b?.imeis_out) ? b.imeis_out : [];
      for (const i of list) {
        const s = String(i || "").trim();
        if (s) imeis.push(s);
      }
    }
    // unique
    const set = new Set<string>();
    for (const i of imeis) set.add(i);
    return set;
  }

  async function eodPreviewRun() {
    if (!eodFile) {
      toast({ kind: "error", title: "Choisis le fichier End of Day (Excel)" });
      return;
    }

    setEodLoading(true);
    setEodPreview(null);
    setEodCommitResult(null);
    setEodSelectedImeis(new Set());
    setEodImeiSearch("");

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      const fd = new FormData();
      fd.append("file", eodFile);
      fd.append("mode", "preview");

      // ✅ route correcte
      const res = await fetch("/api/outbound/eod", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast({
          kind: "error",
          title: "Preview failed",
          message: json.error || "Error",
        });
        return;
      }

      setEodPreview(json);

      // ✅ auto-select tous les IMEI qui vont sortir (tu pourras décocher)
      const set = buildSelectedFromPreview(json);
      setEodSelectedImeis(set);

      toast({ kind: "success", title: "Preview ready" });
    } catch (e: any) {
      toast({
        kind: "error",
        title: "Preview failed",
        message: e?.message || "Error",
      });
    } finally {
      setEodLoading(false);
    }
  }

  async function eodCommitRun() {
    if (!eodFile) {
      toast({ kind: "error", title: "Choisis le fichier End of Day (Excel)" });
      return;
    }

    if (!eodPreview) {
      toast({ kind: "error", title: "Fais un preview avant commit 😄" });
      return;
    }

    const selected = Array.from(eodSelectedImeis);
    if (selected.length === 0) {
      toast({
        kind: "error",
        title: "Aucun IMEI sélectionné",
        message: "Tu as tout décoché 😅",
      });
      return;
    }

    setEodCommitLoading(true);
    setEodCommitResult(null);

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      const fd = new FormData();
      fd.append("file", eodFile);
      fd.append("mode", "commit");

      // ✅ on envoie la sélection (après suppression manuelle)
      fd.append("selected_imeis", JSON.stringify(selected));

      const res = await fetch("/api/outbound/eod", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        toast({
          kind: "error",
          title: "Commit failed",
          message: json.error || "Error",
        });
        return;
      }

      setEodCommitResult(json);
      toast({ kind: "success", title: "Stock updated (OUT)" });
    } catch (e: any) {
      toast({
        kind: "error",
        title: "Commit failed",
        message: e?.message || "Error",
      });
    } finally {
      setEodCommitLoading(false);
    }
  }

  const imeiCount = cleanImeisFromText(scanText).length;

  // ✅ liste IMEI preview (filtrable)
  const eodAllImeis = useMemo(() => {
    if (!eodPreview) return [];
    const set = buildSelectedFromPreview(eodPreview);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [eodPreview]);

  const eodImeisFiltered = useMemo(() => {
    const q = eodImeiSearch.trim();
    if (!q) return eodAllImeis;
    return eodAllImeis.filter((i) => i.includes(q));
  }, [eodAllImeis, eodImeiSearch]);

  function toggleEodImei(imei: string) {
    setEodSelectedImeis((prev) => {
      const next = new Set(prev);
      if (next.has(imei)) next.delete(imei);
      else next.add(imei);
      return next;
    });
  }

  function selectAllEod(filteredOnly = false) {
    const list = filteredOnly ? eodImeisFiltered : eodAllImeis;
    setEodSelectedImeis((prev) => {
      const next = new Set(prev);
      for (const i of list) next.add(i);
      return next;
    });
  }

  function clearAllEod(filteredOnly = false) {
    if (!filteredOnly) {
      setEodSelectedImeis(new Set());
      return;
    }
    setEodSelectedImeis((prev) => {
      const next = new Set(prev);
      for (const i of eodImeisFiltered) next.delete(i);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h1 className="text-xl font-semibold">Outbound + Movements + End of day</h1>
        <p className="text-sm text-slate-400 mt-1">
          QR = IMEIs only. Outbound = sortir des IMEI. Movements = déplacer boîtes. End of day = import Excel + preview + commit.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "outbound"} onClick={() => setTab("outbound")}>
          Outbound
        </TabButton>
        <TabButton active={tab === "movements"} onClick={() => setTab("movements")}>
          Movements
        </TabButton>
        <TabButton active={tab === "eod"} onClick={() => setTab("eod")}>
          End of day report
        </TabButton>
      </div>

      {tab !== "eod" ? (
        <>
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
            <div className="text-sm font-semibold">
              {tab === "outbound" ? "Outbound scan" : "Déplacer une boîte"}
            </div>

            <textarea
              value={scanText}
              onChange={(e) => setScanText(e.target.value)}
              rows={6}
              placeholder={`Scanne ou colle ici…
Ex:
355123456789012
355123456789013`}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                IMEIs détectés:{" "}
                <span className="font-semibold text-slate-200">{imeiCount}</span>
              </div>

              {tab === "movements" ? (
                <div className="flex items-center gap-2">
                  <select
                    value={toLocation}
                    onChange={(e) => setToLocation(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
                  >
                    {LOCATIONS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={runMovement}
                    disabled={moveLoading}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {moveLoading ? "Moving…" : "Move"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={runOutbound}
                  disabled={outLoading}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {outLoading ? "Outbound…" : "Outbound"}
                </button>
              )}
            </div>
          </div>

          <ResultPanel
            title={tab === "outbound" ? "Outbound result" : "Movement result"}
            data={tab === "outbound" ? outResult : moveResult}
          />
        </>
      ) : (
        <>
          <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
            <div className="text-sm font-semibold">Import End of Day report (Excel)</div>
            <div className="text-xs text-slate-500">
              Preview = montre quelles boîtes vont perdre combien d’IMEI et combien restent. Commit = met ces IMEI en OUT.
            </div>

            <input type="file" onChange={(e) => setEodFile(e.target.files?.[0] || null)} />

            <div className="flex flex-wrap gap-2">
              <button
                onClick={eodPreviewRun}
                disabled={!eodFile || eodLoading}
                className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
              >
                {eodLoading ? "Preview…" : "Preview"}
              </button>

              <button
                onClick={eodCommitRun}
                disabled={!eodFile || eodCommitLoading || !eodPreview}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {eodCommitLoading ? "Committing…" : `Commit OUT (${eodSelectedImeis.size})`}
              </button>
            </div>
          </div>

          {eodPreview ? (
            <>
              <EodPreviewPanel data={eodPreview} />

              {/* ✅ IMEI selector */}
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">IMEIs sélectionnés pour sortir</div>
                    <div className="text-xs text-slate-500">
                      Tu peux décocher des IMEI avant commit.
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-2 md:items-center">
                    <input
                      value={eodImeiSearch}
                      onChange={(e) => setEodImeiSearch(e.target.value)}
                      placeholder="Search IMEI…"
                      className="border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm w-full md:w-[220px]"
                    />
                    <button
                      onClick={() => selectAllEod(true)}
                      className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                    >
                      Select filtered
                    </button>
                    <button
                      onClick={() => clearAllEod(true)}
                      className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                    >
                      Clear filtered
                    </button>
                    <button
                      onClick={() => selectAllEod(false)}
                      className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => clearAllEod(false)}
                      className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-400">
                  Total IMEI preview:{" "}
                  <span className="font-semibold text-slate-200">{eodAllImeis.length}</span>{" "}
                  · Selected:{" "}
                  <span className="font-semibold text-slate-200">{eodSelectedImeis.size}</span>
                </div>

                <div className="max-h-[340px] overflow-auto rounded-xl border border-slate-800 bg-slate-950">
                  {eodImeisFiltered.length === 0 ? (
                    <div className="p-3 text-xs text-slate-400">No IMEI match.</div>
                  ) : (
                    <ul className="divide-y divide-slate-800">
                      {eodImeisFiltered.map((imei) => {
                        const checked = eodSelectedImeis.has(imei);
                        return (
                          <li key={imei} className="flex items-center justify-between gap-3 p-2 hover:bg-slate-900/40">
                            <label className="flex items-center gap-3 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEodImei(imei)}
                                className="accent-rose-500"
                              />
                              <span className="text-sm text-slate-100 font-mono">{imei}</span>
                            </label>
                            <span className="text-xs text-slate-500">
                              {checked ? "will OUT" : "ignored"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : null}

          {eodCommitResult ? <ResultPanel title="Commit result" data={eodCommitResult} /> : null}
        </>
      )}
    </div>
  );
}

function EodPreviewPanel({ data }: { data: any }) {
  const boxes = Array.isArray(data?.boxes) ? data.boxes : [];

  // API v2 keys
  const totalSelected = Number(data?.imeis_total_selected ?? 0);
  const willOut = Number(data?.imeis_will_go_out_count ?? 0);
  const missingCount = Number(data?.imeis_missing_count ?? 0);
  const notInCount = Number(data?.imeis_not_in_stock_count ?? 0);

  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
      <div className="text-sm font-semibold">Preview</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Selected" value={totalSelected} />
        <Stat label="Will go OUT" value={willOut} />
        <Stat label="Missing" value={missingCount} />
        <Stat label="Not IN" value={notInCount} />
      </div>

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
            {boxes.map((b: any) => (
              <tr key={b.box_id} className="hover:bg-slate-950/50">
                <td className="p-2 border-b border-slate-800">{b.device}</td>
                <td className="p-2 border-b border-slate-800">{b.box_no}</td>
                <td className="p-2 border-b border-slate-800">{b.location}</td>
                <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.total_in_before}</td>
                <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.out_now}</td>
                <td className="p-2 border-b border-slate-800 text-right font-semibold">{b.remaining_after}</td>
              </tr>
            ))}
            {boxes.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-400" colSpan={6}>
                  Aucun IMEI IN trouvé (ou rien à sortir).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ResultPanel title="Preview JSON" data={data} />
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