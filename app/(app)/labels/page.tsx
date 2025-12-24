"use client";

import { useMemo, useState } from "react";

function normalizeImeis(raw: string): string[] {
  const parts = raw
    .split(/\r?\n|,|;|\t|\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const cleaned = parts
    .map((x) => x.replace(/\D/g, ""))
    .filter((x) => x.length >= 14 && x.length <= 17);
  return Array.from(new Set(cleaned));
}

export default function LabelsPage() {
  const [device, setDevice] = useState("");
  const [boxNo, setBoxNo] = useState("");
  const [imeisText, setImeisText] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string>("");
  const imeis = useMemo(() => normalizeImeis(imeisText), [imeisText]);

  const boxNoDisplay = useMemo(() => {
    const d = device.trim();
    const b = boxNo.trim();
    if (d && b.startsWith(d + "-")) return b.slice(d.length + 1);
    return b;
  }, [device, boxNo]);

  async function generatePreview() {
    setUiError("");
    setPreviewPng(null);

    const d = device.trim();
    const b = boxNo.trim();
    if (!d) return setUiError("Please enter a device name.");
    if (!b) return setUiError("Please enter a box number.");
    if (imeis.length === 0) return setUiError("Please paste at least 1 IMEI.");

    setLoading(true);
    try {
      const QRCode = (await import("qrcode")).default;
      const qrData = `BOX:${b}|DEV:${d}|IMEI:${imeis.join(",")}`;
      const png = await QRCode.toDataURL(qrData, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
      setPreviewPng(png);
    } catch (e: any) {
      setUiError(e?.message || "Failed to generate QR preview");
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    setUiError("");

    const d = device.trim();
    const b = boxNo.trim();
    if (!d) return setUiError("Please enter a device name.");
    if (!b) return setUiError("Please enter a box number.");
    if (imeis.length === 0) return setUiError("Please paste at least 1 IMEI.");

    setLoading(true);
    try {
      const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode")]);

      // Same layout as inbound import PDF: QR centered, then device, then BoxNr.
      const doc = new jsPDF({ unit: "mm", format: [60, 90] });

      const qrData = `BOX:${b}|DEV:${d}|IMEI:${imeis.join(",")}`;
      const qrDataUrl = await QRCode.toDataURL(qrData, { margin: 1, scale: 8 });

      const qrSize = 38;
      const qrX = (60 - qrSize) / 2;
      const qrY = 10;
      doc.addImage(qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(d || "-", 30, 60, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(13);
      doc.text(`BoxNr. ${boxNoDisplay || "-"}`, 30, 70, { align: "center" });

      doc.setFontSize(9);
      doc.text(`IMEI: ${imeis.length}`, 30, 78, { align: "center" });

      doc.save(`manual_label_${d}_${boxNoDisplay || b}.pdf`);
    } catch (e: any) {
      setUiError(e?.message || "Failed to generate PDF");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Labels</div>
        <h2 className="text-xl font-semibold">Manual QR label generator</h2>
        <p className="text-sm text-slate-400 mt-1">
          Fallback mode if the USB scanner is down: paste IMEIs, set Device + BoxNr, then generate the same PDF label as supplier imports.
        </p>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 max-w-3xl space-y-4">
        {uiError ? (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">{uiError}</div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-200">Device name</label>
            <input
              className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 rounded-lg p-2 mt-1 text-sm"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="e.g. FMC234WC3XWU"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-200">Box No (master or inner)</label>
            <input
              className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 rounded-lg p-2 mt-1 font-mono text-sm"
              value={boxNo}
              onChange={(e) => setBoxNo(e.target.value)}
              placeholder="e.g. FMC234WC3XWU-025-007 or 025-36"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Label will show: <span className="text-slate-300 font-mono">{boxNoDisplay || "-"}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-200">IMEIs (paste list)</label>
          <textarea
            className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-600 rounded-lg p-2 mt-1 font-mono text-xs min-h-[160px]"
            value={imeisText}
            onChange={(e) => setImeisText(e.target.value)}
            placeholder={`Paste IMEIs here (one per line)\n\nExample:\n123456789012345\n123456789012346`}
          />
          <div className="flex items-center justify-between mt-2 text-[11px] text-slate-500">
            <div>Valid IMEIs detected: <span className="text-slate-300 font-semibold">{imeis.length}</span></div>
            <div className="text-slate-500">Duplicates are auto-removed</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={generatePreview}
            disabled={loading}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-semibold border border-slate-700 disabled:opacity-50"
          >
            {loading ? "..." : "Generate QR preview"}
          </button>

          <button
            onClick={downloadPdf}
            disabled={loading}
            className="bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "..." : "Download label (PDF)"}
          </button>
        </div>

        {previewPng ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
            <div className="text-xs text-slate-500 mb-2">QR preview</div>
            <img src={previewPng} alt="QR preview" className="max-w-[320px]" />
            <div className="text-[11px] text-slate-500 mt-2">
              The QR contains all IMEIs (comma-separated).
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
