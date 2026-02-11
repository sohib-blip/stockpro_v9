// app/(app)/labels/manual/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type ApiResp = { ok: boolean; error?: string; [k: string]: any };

function cleanImeisFromText(text: string) {
  const raw = String(text || "");
  const parts = raw.split(/[\s,;]+/g).map((x) => x.trim()).filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const p of parts) {
    const digits = p.replace(/\D/g, "");
    if (/^\d{14,17}$/.test(digits) && !seen.has(digits)) {
      seen.add(digits);
      out.push(digits);
    }
  }

  return out;
}

export default function ManualLabelsImportPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [device, setDevice] = useState("");
  const [boxNo, setBoxNo] = useState("");
  const [location, setLocation] = useState("00");

  const [text, setText] = useState("");
  const [imeis, setImeis] = useState<string[]>([]);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);

  const [preview, setPreview] = useState<any>(null);
  const [commitRes, setCommitRes] = useState<any>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  function rebuildImeis() {
    const list = cleanImeisFromText(text);
    setImeis(list);
  }

  function removeImei(i: string) {
    const next = imeis.filter((x) => x !== i);
    setImeis(next);

    // update textarea too (optional)
    setText(next.join("\n"));
  }

  async function run(mode: "preview" | "commit") {
    if (!device.trim() || !boxNo.trim()) {
      toast({ kind: "error", title: "Missing", message: "Device et Box No sont obligatoires." });
      return;
    }
    if (imeis.length === 0) {
      toast({ kind: "error", title: "IMEIs", message: "Ajoute au moins 1 IMEI." });
      return;
    }

    if (mode === "preview") {
      setLoadingPreview(true);
      setPreview(null);
      setCommitRes(null);
    } else {
      setLoadingCommit(true);
      setCommitRes(null);
    }

    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Auth", message: "Pas connecté." });
        return;
      }

      const res = await fetch("/api/inbound/manual", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          device: device.trim(),
          box_no: boxNo.trim(),
          location: location.trim() || "00",
          imeis,
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiResp;

      if (!res.ok || !json?.ok) {
        toast({ kind: "error", title: mode === "preview" ? "Preview failed" : "Commit failed", message: json?.error || "Error" });
        // show details if duplicates
        if (json?.duplicates) setPreview(json);
        return;
      }

      if (mode === "preview") {
        setPreview(json);
        toast({ kind: "success", title: "Preview ready" });
      } else {
        setCommitRes(json);
        toast({ kind: "success", title: "Imported", message: `${json.inserted ?? 0} IMEI ajoutés.` });
      }
    } catch (e: any) {
      toast({ kind: "error", title: "Error", message: e?.message || "Error" });
    } finally {
      setLoadingPreview(false);
      setLoadingCommit(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Manual Import</div>
        <h1 className="text-xl font-semibold">Manual Import (Preview → Commit)</h1>
        <p className="text-sm text-slate-400 mt-1">
          Tu colles/scannes des IMEI, tu peux supprimer des lignes, puis commit. Si doublon DB → ça bloque direct avec détails.
        </p>
      </div>

      {/* META */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">Device (doit exister dans Admin &gt; Devices)</div>
          <input
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            placeholder="ex: FMC920"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Box No</div>
          <input
            value={boxNo}
            onChange={(e) => setBoxNo(e.target.value)}
            placeholder="ex: 041-2"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Location</div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="00"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* INPUT */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">IMEIs</div>
            <div className="text-xs text-slate-500">Colle ou scanne ici (1 par ligne). Puis “Build list”.</div>
          </div>

          <div className="text-xs text-slate-400">
            Total détectés: <span className="text-slate-100 font-semibold">{imeis.length}</span>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={`355123456789012
355123456789013`}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />

        <div className="flex flex-wrap gap-2">
          <button
            onClick={rebuildImeis}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Build list
          </button>

          <button
            onClick={() => run("preview")}
            disabled={loadingPreview || imeis.length === 0}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loadingPreview ? "Preview…" : "Preview"}
          </button>

          <button
            onClick={() => run("commit")}
            disabled={loadingCommit || imeis.length === 0}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loadingCommit ? "Committing…" : "Commit"}
          </button>

          <button
            onClick={() => {
              setText("");
              setImeis([]);
              setPreview(null);
              setCommitRes(null);
            }}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Clear
          </button>
        </div>
      </div>

      {/* LIST */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">List (editable)</div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left border-b border-slate-800">IMEI</th>
                <th className="p-2 text-right border-b border-slate-800">Action</th>
              </tr>
            </thead>
            <tbody>
              {imeis.map((i) => (
                <tr key={i} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800 font-mono text-slate-200">{i}</td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <button
                      onClick={() => removeImei(i)}
                      className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-semibold hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {imeis.length === 0 ? (
                <tr>
                  <td className="p-3 text-slate-400" colSpan={2}>
                    No IMEI list yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* RESULTS */}
      {preview ? <ResultPanel title="Preview result" data={preview} /> : null}
      {commitRes ? <ResultPanel title="Commit result" data={commitRes} /> : null}
    </div>
  );
}

function ResultPanel({ title, data }: { title: string; data: any }) {
  return (
    <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4">
      <div className="text-sm font-semibold">{title}</div>
      <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-slate-200">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}