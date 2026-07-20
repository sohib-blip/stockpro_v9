"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiFetch";

type DeviceRow = { device_id: string; device: string };

type DraftLabel = {
  id: string;
  device_id: string;
  box: string;
  imeisText: string;
};

function uuid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function extractImeis(text: string): string[] {
  const tokens = text.split(/\s+/g).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    const digits = t.replace(/\D/g, "");
    if (digits.length === 15) out.push(digits);
  }
  return Array.from(new Set(out));
}

export default function LabelsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [msg, setMsg] = useState("");

  // ZD220 default label size
  const [wMm, setWMm] = useState(105);
  const [hMm, setHMm] = useState(155);

  const [labels, setLabels] = useState<DraftLabel[]>([
    { id: uuid(), device_id: "", box: "", imeisText: "" },
  ]);

  useEffect(() => {
    (async () => {
      // Load active inventory bins.
      const { data, error } = await supabase
        .from("bins")
        .select("id, name, active")
        .eq("active", true)
        .order("name", { ascending: true });

      if (!error) {
        const list = ((data as any) || []).map((b: any) => ({
          device_id: b.id, // keep same field names for UI
          device: b.name,
        })) as DeviceRow[];

        setDevices(list);

        // default first label selection
        if (list.length > 0) {
          setLabels((prev) =>
            prev.map((l, idx) =>
              idx === 0 && !l.device_id ? { ...l, device_id: list[0].device_id } : l
            )
          );
        }
      }
    })();
  }, [supabase]);

  function updateLabel(id: string, patch: Partial<DraftLabel>) {
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLabel() {
    const defaultDeviceId = devices[0]?.device_id || "";
    setLabels((prev) => [
      ...prev,
      { id: uuid(), device_id: defaultDeviceId, box: "", imeisText: "" },
    ]);
  }

  function removeLabel(id: string) {
    setLabels((prev) => prev.filter((l) => l.id !== id));
  }

  async function downloadPdf() {
    setMsg("");

    const payloadLabels = labels
  .map((l) => {
    const selected = devices.find((d) => d.device_id === l.device_id);

    return {
      device: selected?.device || "",
      box_no: l.box.trim(),
      imeis: extractImeis(l.imeisText),
    };
  })
  .filter((l) => l.device && l.box_no && l.imeis.length > 0);

    if (payloadLabels.length === 0) {
      setMsg("Add at least one valid label with a bin, box number, and IMEI.");
      return;
    }

    const res = await apiFetch("/api/labels/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        w_mm: wMm,
        h_mm: hMm,
        labels: payloadLabels,
      }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setMsg(json?.error || "Label generation failed");
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labels_${wMm}x${hMm}mm.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 w-full">
      <div>
        <div className="text-xs text-slate-500">Inventory</div>
        <h2 className="text-xl font-semibold">Warehouse Label Printing</h2>
        <p className="text-sm text-slate-400 mt-1">
        </p>
      </div>

      <div className="card-glow p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-semibold">Label Dimensions</div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Width (mm)</span>
            <input
              type="number"
              aria-label="Label width"
              value={wMm}
              onChange={(e) => setWMm(Number(e.target.value))}
              className="w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Height (mm)</span>
            <input
              type="number"
              aria-label="Label height"
              value={hMm}
              onChange={(e) => setHMm(Number(e.target.value))}
              className="w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            />
          </div>

          <div className="flex-1" />

          <button
            onClick={addLabel}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Add Label
          </button>

          <button
            onClick={downloadPdf}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
          >
            Download All Labels
          </button>
        </div>

        {msg && (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {msg}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {labels.map((l, idx) => {
          const imeis = extractImeis(l.imeisText);
          return (
            <div
              key={l.id}
              className="card-glow p-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">Label #{idx + 1}</div>
                {labels.length > 1 && (
                  <button
                    onClick={() => removeLabel(l.id)}
                    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-800"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-xs text-slate-400">Inventory Bin</div>
                  <select
                    aria-label={`Label ${idx + 1} inventory bin`}
                    value={l.device_id}
                    onChange={(e) => updateLabel(l.id, { device_id: e.target.value })}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {devices.length === 0 && <option value="">No bins</option>}
                    {devices.map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.device}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-slate-400">Box Number</div>
                  <input
                    aria-label={`Label ${idx + 1} box number`}
                    value={l.box}
                    onChange={(e) => updateLabel(l.id, { box: e.target.value })}
                    placeholder="ex: BOX-000123"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">IMEIs</div>
                  <div className="text-xs text-slate-400">
                    Detected: <b className="text-slate-200">{imeis.length}</b>
                  </div>
                </div>

                <textarea
                  aria-label={`Label ${idx + 1} IMEIs`}
                  value={l.imeisText}
                  onChange={(e) => updateLabel(l.id, { imeisText: e.target.value })}
                  placeholder="IMEI"
                  className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
