"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DeviceRow = { device_id: string; device: string };

type DraftLabel = {
  id: string;
  device_id: string; // ✅ NOW = bin_id (uuid)
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
      // ✅ NEW SYSTEM: load ACTIVE bins
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
      device: selected?.device || "",   // 🔥 ENVOIE LE NOM
      box_no: l.box.trim(),             // 🔥 aligné avec backend
      imeis: extractImeis(l.imeisText),
    };
  })
  .filter((l) => l.device && l.box_no && l.imeis.length > 0);

    if (payloadLabels.length === 0) {
      setMsg("❌ Ajoute au moins 1 label valide (bin + box + au moins 1 IMEI).");
      return;
    }

    const res = await fetch("/api/labels/generate", {
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
      setMsg("❌ " + (json?.error || "Generation failed"));
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
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Labels</div>
          <h2 className="sp-title">QR Label Generator (ZD220)</h2>
          <p className="sp-desc"></p>
        </div>
      </div>

      <div className="sp-card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-semibold text-sp-text">Label size</div>

          <div className="flex items-center gap-2 text-sm">
            <label className="sp-label mb-0">W (mm)</label>
            <input
              type="number"
              value={wMm}
              onChange={(e) => setWMm(Number(e.target.value))}
              className="sp-input w-24"
            />
          </div>

          <div className="flex items-center gap-2 text-sm">
            <label className="sp-label mb-0">H (mm)</label>
            <input
              type="number"
              value={hMm}
              onChange={(e) => setHMm(Number(e.target.value))}
              className="sp-input w-24"
            />
          </div>

          <div className="flex-1" />

          <button
            onClick={addLabel}
            className="sp-btn sp-btn-ghost"
          >
            + Add label
          </button>

          <button
            onClick={downloadPdf}
            className="sp-btn sp-btn-primary"
          >
            Download PDF (all labels)
          </button>
        </div>

        {msg && (
          <div className="sp-alert sp-alert-err">{msg}</div>
        )}
      </div>

      <div className="space-y-4">
        {labels.map((l, idx) => {
          const imeis = extractImeis(l.imeisText);
          return (
            <div
              key={l.id}
              className="sp-card space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-sp-text">Label #{idx + 1}</div>
                {labels.length > 1 && (
                  <button
                    onClick={() => removeLabel(l.id)}
                    className="sp-btn sp-btn-ghost"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="sp-label">Bin / Device</label>
                  <select
                    value={l.device_id}
                    onChange={(e) => updateLabel(l.id, { device_id: e.target.value })}
                    className="sp-select"
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
                  <label className="sp-label">Box ID / Box No</label>
                  <input
                    value={l.box}
                    onChange={(e) => updateLabel(l.id, { box: e.target.value })}
                    placeholder="ex: BOX-000123"
                    className="sp-input"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="sp-label mb-0">IMEIs</label>
                  <div className="text-xs text-sp-muted">
                    Detected: <b className="sp-badge sp-badge-brand">{imeis.length}</b>
                  </div>
                </div>

                <textarea
                  value={l.imeisText}
                  onChange={(e) => updateLabel(l.id, { imeisText: e.target.value })}
                  placeholder="IMEI"
                  className="sp-textarea h-32"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
