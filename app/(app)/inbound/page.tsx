"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string>("");

  async function parse() {
    setErr("");
    setResult(null);
    if (!file) return setErr("Please choose a file.");

    setBusy(true);
    try {
      const { data: devs, error: devErr } = await supabase
        .from("devices")
        .select("canonical_name,device,active");
      if (devErr) throw devErr;

      const deviceMatches = toDeviceMatchList((devs as any) || []);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseVendorExcel(vendor as any, bytes, deviceMatches);
      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message ?? "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">Inbound Import</h2>
        <p className="text-sm text-slate-400 mt-1">
          Upload supplier Excel → parse → preview labels. (DB save step can be plugged in here.)
        </p>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
          >
            <option value="teltonika">Teltonika</option>
            <option value="quicklink">Quicklink</option>
            <option value="digitalmatter">Digital Matter</option>
            <option value="truster">Truster</option>
          </select>

          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="border border-slate-800 bg-slate-950 text-slate-100 rounded-xl px-3 py-2 text-sm"
          />

          <button
            onClick={parse}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Parsing…" : "Parse"}
          </button>
        </div>

        {err && <div className="text-sm text-rose-200 border border-rose-900/60 bg-rose-950/40 p-3 rounded-xl">{err}</div>}
      </div>

      {!result ? null : result.ok ? (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
              <span className="text-slate-400">Devices:</span> <b>{result.counts?.devices ?? 0}</b>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
              <span className="text-slate-400">Boxes:</span> <b>{result.counts?.boxes ?? 0}</b>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
              <span className="text-slate-400">Items:</span> <b>{result.counts?.items ?? 0}</b>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="text-left p-2 border-b border-slate-800">Device</th>
                  <th className="text-left p-2 border-b border-slate-800">Box</th>
                  <th className="text-right p-2 border-b border-slate-800">Qty</th>
                  <th className="text-right p-2 border-b border-slate-800">IMEIs</th>
                </tr>
              </thead>
              <tbody>
                {result.labels.map((l: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800 font-semibold">{l.device}</td>
                    <td className="p-2 border-b border-slate-800">{l.box_no}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{Number(l.qty ?? 0)}</td>
                    <td className="p-2 border-b border-slate-800 text-right">{Array.isArray(l.imeis) ? l.imeis.length : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">
          {result.error || "Import error"}
        </div>
      )}
    </div>
  );
}
