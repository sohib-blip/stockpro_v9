"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { LOCATIONS } from "@/lib/device";

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

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function OutboundUnifiedPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [tab, setTab] = useState<"outbound" | "movements">("outbound");
  const [scanText, setScanText] = useState("");

  const [outLoading, setOutLoading] = useState(false);
  const [outResult, setOutResult] = useState<any>(null);

  const [moveLoading, setMoveLoading] = useState(false);
  const [moveResult, setMoveResult] = useState<any>(null);
  const [toLocation, setToLocation] = useState<(typeof LOCATIONS)[number]>("00");

  const [eodLoading, setEodLoading] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function runOutbound() {
    const imeis = cleanImeisFromText(scanText);
    if (imeis.length === 0) {
      toast({ kind: "error", title: "Scan un IMEI (ou colle plusieurs IMEIs)" });
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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ imei: imeis[0], imeis }),
      });

      const json = (await res.json()) as ApiResp;

      if (!res.ok || !json.ok) {
        toast({ kind: "error", title: "Outbound failed", message: json.error || "Error" });
        return;
      }

      setOutResult(json);
      toast({ kind: "success", title: "Outbound OK" });
    } catch (e: any) {
      toast({ kind: "error", title: "Outbound failed", message: e?.message || "Error" });
    } finally {
      setOutLoading(false);
    }
  }

  async function runMovement() {
    const imeis = cleanImeisFromText(scanText);
    if (imeis.length === 0) {
      toast({ kind: "error", title: "Scan un IMEI (ou colle plusieurs IMEIs)" });
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
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ imei: imeis[0], imeis, to_location: toLocation }),
      });

      const json = (await res.json()) as ApiResp;

      if (!res.ok || !json.ok) {
        toast({ kind: "error", title: "Movement failed", message: json.error || "Error" });
        return;
      }

      setMoveResult(json);
      toast({ kind: "success", title: `Déplacé vers ${toLocation}` });
    } catch (e: any) {
      toast({ kind: "error", title: "Movement failed", message: e?.message || "Error" });
    } finally {
      setMoveLoading(false);
    }
  }

  // ✅ End of day report (download)
  async function downloadEndOfDay() {
    setEodLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Please sign in first." });
        return;
      }

      // IMPORTANT: this endpoint must exist in your project.
      // If it doesn't, you'll get 404 — tell me and I'll give you the full backend file too.
      const res = await fetch("/api/reports/end-of-day", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let msg = "Report failed";
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {}
        toast({ kind: "error", title: "End of day report", message: msg });
        return;
      }

      const blob = await res.blob();
      const filename = `end_of_day_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(filename, blob);
      toast({ kind: "success", title: "Report downloaded" });
    } finally {
      setEodLoading(false);
    }
  }

  const imeiCount = cleanImeisFromText(scanText).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Outbound</div>
          <h1 className="text-xl font-semibold">Outbound + Movements</h1>
          <p className="text-sm text-slate-400 mt-1">QR = IMEIs only. Tu peux scanner 1 IMEI ou coller plusieurs IMEIs.</p>
        </div>

        <button
          onClick={downloadEndOfDay}
          disabled={eodLoading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {eodLoading ? "Generating…" : "End of day report"}
        </button>
      </div>

      <div className="flex gap-2">
        <TabButton active={tab === "outbound"} onClick={() => setTab("outbound")}>
          Outbound
        </TabButton>
        <TabButton active={tab === "movements"} onClick={() => setTab("movements")}>
          Movements
        </TabButton>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">{tab === "outbound" ? "Outbound scan" : "Déplacer une boîte"}</div>

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
            IMEIs détectés: <span className="font-semibold text-slate-200">{imeiCount}</span>
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

      <ResultPanel title={tab === "outbound" ? "Outbound result" : "Movement result"} data={tab === "outbound" ? outResult : moveResult} />
    </div>
  );
}

function ResultPanel({ title, data }: { title: string; data: any }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-slate-500 mt-1">Détails JSON (debug)</div>

      <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-200 bg-slate-950 border border-slate-800 rounded-xl p-3">
        {data ? JSON.stringify(data, null, 2) : "—"}
      </pre>
    </div>
  );
}