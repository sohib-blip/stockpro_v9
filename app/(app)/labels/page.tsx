"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type BoxRow = {
  box_id: string;
  box_no: string | null;
  master_box_no?: string | null;
  device: string | null;
  location?: string | null;
  status?: string | null;
};

function cleanImei(v: any): string | null {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 15 ? s : null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function LabelsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  async function loadBoxes() {
    setLoading(true);
    try {
      const res = await supabase
        .from("boxes")
        .select("box_id, box_no, master_box_no, device, location, status")
        .order("created_at", { ascending: false })
        .limit(500);

      if (res.error) throw res.error;
      setBoxes((res.data as any) || []);
    } catch (e: any) {
      toast({ kind: "error", title: "Load failed", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return boxes;

    return boxes.filter((b) => {
      const device = String(b.device ?? "").toLowerCase();
      const boxNo = String(b.box_no ?? "").toLowerCase();
      const master = String(b.master_box_no ?? "").toLowerCase();
      const loc = String(b.location ?? "").toLowerCase();
      return device.includes(qq) || boxNo.includes(qq) || master.includes(qq) || loc.includes(qq);
    });
  }, [boxes, q]);

  const selectedBoxes = useMemo(() => {
    return boxes.filter((b) => selected[b.box_id]);
  }, [boxes, selected]);

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {};
    if (on) {
      for (const b of filtered) next[b.box_id] = true;
    }
    setSelected(next);
  }

  async function getQrDataForBox(box_id: string): Promise<string> {
    // ✅ IMEI-only from DB (items table), 1 per line
    const r = await supabase
      .from("items")
      .select("imei")
      .eq("box_id", box_id)
      .order("imei", { ascending: true });

    if (r.error) throw r.error;

    const imeis = Array.from(
      new Set((r.data || []).map((x: any) => cleanImei(x.imei)).filter(Boolean) as string[])
    );

    if (!imeis.length) throw new Error("No valid IMEI in this box");
    return imeis.join("\n");
  }

  async function copyQrData(box: BoxRow) {
    try {
      const qr = await getQrDataForBox(box.box_id);
      await navigator.clipboard.writeText(qr);
      toast({
        kind: "success",
        title: "Copied",
        message: `QR data copied (IMEI only): ${qr.split("\n").length} IMEI`,
      });
    } catch (e: any) {
      toast({ kind: "error", title: "Copy failed", message: e?.message || "Error" });
    }
  }

  async function downloadPdfForBoxes(target: BoxRow[]) {
    if (!target.length) {
      toast({ kind: "error", title: "Select at least one box" });
      return;
    }

    setLoading(true);
    try {
      // ✅ uses your server route: /api/labels/pdf/boxes (POST)
      const res = await fetch("/api/labels/pdf/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boxes: target.map((b) => ({
            box_id: b.box_id,
            box_no: b.box_no ?? "",
            device: b.device ?? "",
          })),
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `PDF generation failed (${res.status})`);
      }

      const pdfBlob = await res.blob();
      const name =
        target.length === 1
          ? `label_${String(target[0].device ?? "device").replace(/\s+/g, "_")}_${String(target[0].box_no ?? "box")}.pdf`
          : `labels_${target.length}_boxes.pdf`;

      downloadBlob(pdfBlob, name);
      toast({ kind: "success", title: "PDF downloaded", message: name });
    } catch (e: any) {
      toast({ kind: "error", title: "PDF failed", message: e?.message || "Error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Labels</div>
          <h2 className="text-xl font-semibold">QR Labels</h2>
          <p className="text-sm text-slate-400 mt-1">
            QR = <span className="text-slate-200 font-semibold">IMEI only</span>, 1 par ligne.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={loadBoxes}
            disabled={loading}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>

          <button
            onClick={() => downloadPdfForBoxes(selectedBoxes)}
            disabled={loading || selectedBoxes.length === 0}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Download PDF ({selectedBoxes.length || 0})
          </button>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search device, box, master box, location…"
            className="w-full md:w-[420px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />

          <div className="flex gap-2">
            <button
              onClick={() => toggleAll(true)}
              disabled={loading || filtered.length === 0}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold hover:bg-slate-900 disabled:opacity-50"
            >
              Select all (filtered)
            </button>

            <button
              onClick={() => toggleAll(false)}
              disabled={loading}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm font-semibold hover:bg-slate-900 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="text-left p-2 border-b border-slate-800 w-[44px]">Sel</th>
                <th className="text-left p-2 border-b border-slate-800">Device</th>
                <th className="text-left p-2 border-b border-slate-800">Box</th>
                <th className="text-left p-2 border-b border-slate-800">Master</th>
                <th className="text-left p-2 border-b border-slate-800">Location</th>
                <th className="text-right p-2 border-b border-slate-800">Actions</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((b) => {
                const isSel = !!selected[b.box_id];
                return (
                  <tr key={b.box_id} className="hover:bg-slate-950/50">
                    <td className="p-2 border-b border-slate-800">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={(e) => setSelected((s) => ({ ...s, [b.box_id]: e.target.checked }))}
                      />
                    </td>
                    <td className="p-2 border-b border-slate-800">
                      <div className="text-slate-100 font-semibold">{b.device || "—"}</div>
                    </td>
                    <td className="p-2 border-b border-slate-800">
                      <div className="text-slate-200">{b.box_no || "—"}</div>
                    </td>
                    <td className="p-2 border-b border-slate-800">
                      <div className="text-slate-400">{b.master_box_no || "—"}</div>
                    </td>
                    <td className="p-2 border-b border-slate-800">
                      <div className="text-slate-300">{b.location || "—"}</div>
                    </td>
                    <td className="p-2 border-b border-slate-800 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => copyQrData(b)}
                          disabled={loading}
                          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-900 disabled:opacity-50"
                        >
                          Copy QR data
                        </button>

                        <button
                          onClick={() => downloadPdfForBoxes([b])}
                          disabled={loading}
                          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold hover:bg-slate-900 disabled:opacity-50"
                        >
                          Download PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td className="p-3 text-sm text-slate-400" colSpan={6}>
                    No boxes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-slate-500">
          Selected: <span className="text-slate-200 font-semibold">{selectedBoxes.length}</span>
        </div>
      </div>
    </div>
  );
}
