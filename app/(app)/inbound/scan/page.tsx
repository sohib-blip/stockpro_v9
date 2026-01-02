"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type ParsedBox = {
  device: string;
  box_no: string;
  master_box_no?: string;
  imeis: string[];
};

function parseQrText(raw: string): ParsedBox | null {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  // Support formats:
  // DEV:xxx\nBOX:yyy\nIMEI...\nIMEI...
  // Or legacy with | separators
  const lines = text.includes("|")
    ? text.split("|").map((s) => s.trim()).filter(Boolean)
    : text.split("\n").map((s) => s.trim()).filter(Boolean);

  let device = "";
  let box_no = "";
  let master_box_no = "";
  const imeis: string[] = [];

  for (const line of lines) {
    const up = line.toUpperCase();

    if (up.startsWith("DEV:")) device = line.slice(4).trim();
    else if (up.startsWith("DEVICE:")) device = line.slice(7).trim();
    else if (up.startsWith("BOX:")) box_no = line.slice(4).trim();
    else if (up.startsWith("BOX_NO:")) box_no = line.slice(7).trim();
    else if (up.startsWith("MASTER:")) master_box_no = line.slice(7).trim();
    else if (/^\d{12,20}$/.test(line.replace(/\s+/g, ""))) imeis.push(line.replace(/\s+/g, ""));
  }

  // If not key-value format, attempt fallback:
  // first line device, second box, rest imeis
  if (!device && lines.length >= 1 && !lines[0].includes(":")) device = lines[0];
  if (!box_no && lines.length >= 2 && !lines[1].includes(":")) box_no = lines[1];

  if (!device || !box_no || imeis.length === 0) return null;

  return {
    device,
    box_no,
    master_box_no: master_box_no || `${device}-${box_no}`,
    imeis: Array.from(new Set(imeis)),
  };
}

export default function InboundScanPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);

  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedBox | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ok = typeof window !== "undefined" && "BarcodeDetector" in window;
    setSupported(ok);
    // @ts-ignore
    if (ok) detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
  }, []);

  useEffect(() => {
    setParsed(parseQrText(rawText));
  }, [rawText]);

  async function start() {
    if (!videoRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setRunning(true);
      loopDetect();
    } catch (e: any) {
      toast({ kind: "error", title: "Camera error", message: e?.message ?? "Cannot access camera" });
    }
  }

  function stop() {
    setRunning(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function loopDetect() {
    if (!detectorRef.current || !videoRef.current) return;
    if (!running) return;

    try {
      const barcodes = await detectorRef.current.detect(videoRef.current);
      if (barcodes?.length) {
        const v = barcodes[0]?.rawValue || "";
        if (v && v !== rawText) {
          setRawText(v);
          // auto stop when found
          stop();
          toast({ kind: "success", title: "QR detected" });
        }
      }
    } catch {
      // ignore
    }

    requestAnimationFrame(loopDetect);
  }

  async function importBox() {
    if (!parsed) {
      toast({ kind: "error", title: "Invalid QR", message: "Missing DEV/BOX/IMEIs" });
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Please sign in first.");

      const res = await fetch("/api/inbound/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device: parsed.device,
          box_no: parsed.box_no,
          master_box_no: parsed.master_box_no,
          imeis: parsed.imeis,
        }),
      });

      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "Import failed");
      }

      toast({
        kind: "success",
        title: "Inbound imported",
        message: `${parsed.device} / ${parsed.box_no} (${parsed.imeis.length} IMEI)`,
      });

      setRawText("");
      setParsed(null);
    } catch (e: any) {
      toast({ kind: "error", title: "Import failed", message: e?.message ?? "Error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Inbound</div>
        <h2 className="text-xl font-semibold">📷 Scan QR (Inbound)</h2>
        <p className="text-sm text-slate-400 mt-1">
          Scan a QR that contains DEV/BOX + IMEIs on new lines. Or paste raw QR text.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="text-sm font-semibold">Camera</div>

          {supported ? (
            <>
              <video ref={videoRef} className="w-full rounded-xl border border-slate-800 bg-black" />
              <div className="flex gap-2">
                {!running ? (
                  <button
                    onClick={start}
                    className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                  >
                    Start camera
                  </button>
                ) : (
                  <button
                    onClick={stop}
                    className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                  >
                    Stop
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-500">
                Tip: Chrome/Edge desktop + mobile OK. If camera not supported, use paste mode.
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-300">
              Camera scan not supported on this browser. Use paste mode 👉
            </div>
          )}
        </div>

        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="text-sm font-semibold">Paste QR content</div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`DEV:FMC234WC3XWU\nBOX:025-007\n3567...\n3567...\n...`}
            className="w-full h-[200px] border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl p-3 text-sm"
          />

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
            {parsed ? (
              <div className="space-y-1">
                <div><span className="text-slate-500">Device:</span> <b>{parsed.device}</b></div>
                <div><span className="text-slate-500">Box:</span> <b>{parsed.box_no}</b></div>
                <div><span className="text-slate-500">IMEIs:</span> <b>{parsed.imeis.length}</b></div>
              </div>
            ) : (
              <div className="text-slate-400">Waiting for valid QR data…</div>
            )}
          </div>

          <button
            onClick={importBox}
            disabled={!parsed || saving}
            className="w-full rounded-xl bg-slate-900 border border-slate-800 px-4 py-3 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Importing…" : "Import this box"}
          </button>
        </div>
      </div>
    </div>
  );
}
