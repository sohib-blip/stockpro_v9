"use client";

import React, { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type Vendor = "teltonika" | "quicklink" | "truster" | "digitalmatter";
type ImportFormat =
  | "teltonika_serial_multi" // ✅ celui qu’on a déjà (multi blocks)
  | "teltonika_serial_simple"
  | "quicklink_default"
  | "truster_default"
  | "digitalmatter_default";

type LabelRow = {
  device: string;
  box_no: string;
  qty: number;
  qr_data: string;
  box_id?: string | null;
};

const VENDORS: Array<{ key: Vendor; label: string }> = [
  { key: "teltonika", label: "Teltonika" },
  { key: "quicklink", label: "Quicklink" },
  { key: "truster", label: "Truster" },
  { key: "digitalmatter", label: "DigitalMatter" },
];

const FORMATS_BY_VENDOR: Record<Vendor, Array<{ key: ImportFormat; label: string; hint?: string }>> = {
  teltonika: [
    { key: "teltonika_serial_multi", label: "Serial list — Multi devices (blocks)", hint: "Excel avec plusieurs devices côte à côte" },
    { key: "teltonika_serial_simple", label: "Serial list — Simple (1 device)", hint: "Excel simple, 1 seul bloc" },
  ],
  quicklink: [{ key: "quicklink_default", label: "Default", hint: "Parser Quicklink (à brancher)" }],
  truster: [{ key: "truster_default", label: "Default", hint: "Parser Truster (à brancher)" }],
  digitalmatter: [{ key: "digitalmatter_default", label: "Default", hint: "Parser DigitalMatter (à brancher)" }],
};

export default function InboundImportPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);

  // ✅ locations locked
  const [location, setLocation] = useState<string>("00");

  // ✅ clean UI: tabs vendor + dropdown format
  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [format, setFormat] = useState<ImportFormat>("teltonika_serial_multi");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);

  const [preview, setPreview] = useState<any | null>(null);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [committed, setCommitted] = useState(false);

  const [q, setQ] = useState("");

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  function onPickVendor(v: Vendor) {
    setVendor(v);
    const first = FORMATS_BY_VENDOR[v]?.[0]?.key;
    if (first) setFormat(first);
  }

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

      const formData = new FormData();
      formData.append("file", file);
      formData.append("location", location);
      formData.append("vendor", vendor);
      formData.append("format", format);

      const res = await fetch("/api/inbound/preview", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        // show unknown_devices nicely if present
        if (json?.unknown_devices?.length) {
          toast({
            kind: "error",
            title: "Unknown devices",
            message: `Ajoute d'abord dans Admin > Devices: ${json.unknown_devices.join(", ")}`,
          });
          setPreview(json);
          return;
        }
        throw new Error(json?.error || "Preview failed");
      }

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

      const formData = new FormData();
      formData.append("file", file);
      formData.append("location", location);
      formData.append("vendor", vendor);
      formData.append("format", format);

      const res = await fetch("/api/inbound/commit", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        if (json?.unknown_devices?.length) {
          toast({
            kind: "error",
            title: "Unknown devices",
            message: `Ajoute d'abord dans Admin > Devices: ${json.unknown_devices.join(", ")}`,
          });
          setPreview(json);
          return;
        }
        throw new Error(json?.error || "Import failed");
      }

      setCommitted(true);
      setPreview(json);
      setLabels((json.labels || []) as LabelRow[]);

      toast({
        kind: "success",
        title: "Import OK",
        message: `${json.devices} devices · ${json.boxes} cartons · ${json.items} IMEI`,
      });
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message || "Error" });
    } finally {
      setLoadingCommit(false);
    }
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return labels;
    return labels.filter((l) => {
      const d = String(l.device ?? "").toLowerCase();
      const b = String(l.box_no ?? "").toLowerCase();
      return d.includes(qq) || b.includes(qq);
    });
  }, [labels, q]);

  const stats = useMemo(() => {
    const devices = new Set(labels.map((l) => l.device)).size;
    const boxes = labels.length;
    const items = labels.reduce((acc, l) => acc + (Number(l.qty) || 0), 0);
    return { devices, boxes, items };
  }, [labels]);

  const formatOptions = FORMATS_BY_VENDOR[vendor] || [];
  const activeFormatHint = formatOptions.find((f) => f.key === format)?.hint || "";

  return (
    <div className="space-y-6">
      {/* TOP HEADER */}
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-xs text-slate-500">Inbound</div>
          <h2 className="text-xl font-semibold">Import fournisseurs</h2>
          <p className="text-sm text-slate-400 mt-1">
            Preview → Confirm. Vendor + format = lecture stable (même multi devices).
          </p>
        </div>

        {/* ✅ CLEAN BAR: tabs + format dropdown */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Tabs desktop / dropdown mobile */}
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="hidden md:flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-xl p-1">
              {VENDORS.map((v) => {
                const active = v.key === vendor;
                return (
                  <button
                    key={v.key}
                    onClick={() => onPickVendor(v.key)}
                    className={[
                      "px-3 py-2 text-sm font-semibold rounded-lg transition",
                      active ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-900",
                    ].join(" ")}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>

            <div className="md:hidden flex items-center gap-2">
              <div className="text-sm text-slate-400">Fournisseur</div>
              <select
                value={vendor}
                onChange={(e) => onPickVendor(e.target.value as Vendor)}
                className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm w-full"
              >
                {VENDORS.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <div className="text-sm text-slate-400">Format</div>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ImportFormat)}
                className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm w-full md:w-[340px]"
              >
                {formatOptions.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-500 md:text-right">
            {activeFormatHint ? <span className="text-slate-300">{activeFormatHint}</span> : null}
          </div>
        </div>
      </div>

      {/* IMPORT CARD */}
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <StatCard title="Devices détectés" value={stats.devices} />
          <StatCard title="Cartons" value={stats.boxes} />
          <StatCard title="IMEI parsés" value={stats.items} />
          <StatCard title="Étage" value={location} />
        </div>

        {!preview?.ok && preview?.unknown_devices?.length ? (
          <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            <div className="font-semibold">Unknown devices</div>
            <div className="mt-1">
              Ajoute d’abord dans <span className="font-semibold">Admin &gt; Devices</span> :
              <div className="mt-2 flex flex-wrap gap-2">
                {preview.unknown_devices.map((x: string) => (
                  <span key={x} className="rounded-full border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-xs font-bold">
                    {x}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {!preview?.ok && preview?.error ? (
          <div className="mt-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {String(preview.error)}
          </div>
        ) : null}
      </div>

      {/* LABELS PREVIEW TABLE */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Preview cartons</div>
            <div className="text-xs text-slate-500">Device / BoxNR / Qty (QR = IMEI only, 1 par ligne).</div>
          </div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrer device / carton…"
            className="w-full md:w-[260px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="text-left p-2 border-b border-slate-800">Device</th>
                <th className="text-left p-2 border-b border-slate-800">BoxNR</th>
                <th className="text-right p-2 border-b border-slate-800">Qty IMEI</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={`${l.device}__${l.box_no}`} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800 font-semibold text-slate-100">{l.device}</td>
                  <td className="p-2 border-b border-slate-800 text-slate-200">{l.box_no}</td>
                  <td className="p-2 border-b border-slate-800 text-right text-slate-200">{l.qty}</td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td className="p-3 text-sm text-slate-400" colSpan={3}>
                    No preview rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {committed ? (
          <div className="text-xs text-emerald-300">
            ✅ Import confirmé. (PDF labels et historique on branche après, étape suivante)
          </div>
        ) : (
          <div className="text-xs text-slate-500">Fais Preview puis Confirm import.</div>
        )}
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