"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";

type HistoryRow = {
  batch_id: string;
  created_at: string;
  actor: string;
  vendor: string;
  source: string;
  qty: number;
};

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/inbound/history", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setHistory(json.rows || []);
      else setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function parse() {
    setErr("");
    setResult(null);
    if (!file) return setErr("Choose a file.");

    setBusy(true);
    try {
      const { data: devs, error: devErr } = await supabase
        .from("devices")
        .select("device_id,canonical_name,device,active,units_per_imei");

      if (devErr) throw devErr;

      const deviceMatches = toDeviceMatchList((devs as any) || []);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseVendorExcel(vendor, bytes, deviceMatches);

      // Inject chosen floor into each label
      if (parsed?.ok) {
        parsed.labels = parsed.labels.map((l: any) => ({
          ...l,
          floor,
        }));
      }

      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message || "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmInbound() {
    if (!result?.ok) return;

    // ✅ BLOCK CONFIRM if unknown devices
    if (result.unknown_devices && result.unknown_devices.length > 0) {
      setErr(
        `Import blocked: unknown devices -> ${result.unknown_devices.join(", ")}`
      );
      return;
    }

    setBusy(true);
    setErr("");

    try {
      const payload = {
        labels: result.labels.map((l: any) => ({
          device: l.device,
          box_no: l.box_no,
          floor: l.floor || floor,
          imeis: l.imeis,
        })),
        actor,
        vendor,
      };

      const res = await fetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!json.ok) {
        // ✅ Show unknown devices from API too (double safety)
        if (json.unknown_devices?.length) {
          setErr(
            `Import blocked: unknown devices -> ${json.unknown_devices.join(
              ", "
            )}`
          );
          return;
        }
        throw new Error(json.error || "Confirm failed");
      }

      setResult(null);
      setFile(null);

      alert(
        `Inbound OK ✅\nInserted: ${json.totals.inserted_imeis}\nSkipped(existing): ${json.totals.skipped_existing_imeis}\nBoxes created: ${json.totals.created_boxes}\nBoxes reused: ${json.totals.reused_boxes}`
      );

      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  const previewTotals = result?.ok
    ? {
        boxes: result.labels.length,
        imeis: result.labels.reduce(
          (a: number, l: any) => a + (l.imeis?.length || 0),
          0
        ),
      }
    : { boxes: 0, imeis: 0 };

  const hasUnknown =
    result?.ok && Array.isArray(result.unknown_devices) && result.unknown_devices.length > 0;

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">Inbound Import</h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{actor}</b>
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={vendor}
            onChange={(e) => setVendor(e.target.value as Vendor)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
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
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>

          <button
            onClick={parse}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Working…" : "Preview import"}
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {err}
          </div>
        )}
      </div>

      {/* Preview */}
      {result?.ok && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold">
              Preview: {previewTotals.boxes} boxes • {previewTotals.imeis} IMEIs
            </div>

            <button
              onClick={confirmInbound}
              disabled={busy || hasUnknown}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Confirm Inbound (Save)
            </button>
          </div>

          {/* Unknown devices warning (STRICT) */}
          {hasUnknown && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200">
              <div className="font-semibold">Import blocked</div>
              <div className="mt-1">
                Unknown devices found: <b>{result.unknown_devices.join(", ")}</b>
              </div>
              <div className="text-xs text-amber-200/70 mt-1">
                Add these devices in Admin → Devices (or add aliases), then re-import.
              </div>
            </div>
          )}

          <div className="overflow-auto">
            <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
              <thead className="bg-slate-950/50">
                <tr>
                  <th className="p-2 border-b border-slate-800 text-left">Device</th>
                  <th className="p-2 border-b border-slate-800 text-left">Box</th>
                  <th className="p-2 border-b border-slate-800 text-left">Floor</th>
                  <th className="p-2 border-b border-slate-800 text-right">IMEIs</th>
                </tr>
              </thead>
              <tbody>
                {result.labels.map((l: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-950/40">
                    <td className="p-2 border-b border-slate-800 font-semibold">
                      {l.device}
                    </td>
                    <td className="p-2 border-b border-slate-800">{l.box_no}</td>
                    <td className="p-2 border-b border-slate-800">
                      {l.floor || floor}
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      {l.imeis?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Inbound history</div>
            <div className="text-xs text-slate-500">
              Each line = one inbound batch. Download Excel to trace device/box/IMEI.
            </div>
          </div>

          <button
            onClick={loadHistory}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            {loadingHistory ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 border-b border-slate-800 text-left">Date/Time</th>
                <th className="p-2 border-b border-slate-800 text-left">User</th>
                <th className="p-2 border-b border-slate-800 text-left">Vendor</th>
                <th className="p-2 border-b border-slate-800 text-right">Qty</th>
                <th className="p-2 border-b border-slate-800 text-right">Excel</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.batch_id} className="hover:bg-slate-950/40">
                  <td className="p-2 border-b border-slate-800">{fmtDateTime(h.created_at)}</td>
                  <td className="p-2 border-b border-slate-800">{h.actor}</td>
                  <td className="p-2 border-b border-slate-800">{h.vendor}</td>
                  <td className="p-2 border-b border-slate-800 text-right font-semibold">{h.qty}</td>
                  <td className="p-2 border-b border-slate-800 text-right">
                    <a
                      href={`/api/inbound/export?batch_id=${encodeURIComponent(h.batch_id)}`}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800 inline-block"
                    >
                      Excel
                    </a>
                  </td>
                </tr>
              ))}

              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-3 text-slate-400">
                    No inbound batches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}