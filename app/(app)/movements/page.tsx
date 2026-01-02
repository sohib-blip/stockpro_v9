"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type MoveEvent = {
  id: string;
  box_id: string;
  from_location: string | null;
  to_location: string;
  note: string | null;
  created_by_email: string | null;
  created_at: string;
  box: null | {
    box_id: string;
    device: string | null;
    master_box_no: string | null;
    box_no: string | null;
    location: string | null;
    status: string | null;
  };
};

async function safeJson(res: Response) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { ok: false, error: txt || "Invalid JSON response" };
  }
}

export default function MovementsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const inputRef = useRef<HTMLInputElement | null>(null);

  const [raw, setRaw] = useState("");
  const [toLoc, setToLoc] = useState<"00" | "1" | "6" | "Cabinet">("00");
  const [note, setNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<MoveEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function refreshHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/movements/history?limit=150");
      const json = await safeJson(res);
      if (json.ok) setEvents(json.events || []);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
    void refreshHistory();
  }, []);

  async function confirmMove() {
    if (!raw.trim()) {
      toast({ kind: "error", title: "Scan required", message: "Scan/paste a box QR first." });
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Not signed in", message: "Please login." });
        return;
      }

      const res = await fetch("/api/movements/box", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ qr: raw.trim(), to_location: toLoc, note }),
      });

      const json = await safeJson(res);
      if (!json.ok) {
        toast({ kind: "error", title: "Move failed", message: json.error || "Unknown error" });
        return;
      }

      toast({
        kind: "success",
        title: "Location updated",
        message: `${json.box?.device || "-"} → ${toLoc}`,
      });

      setRaw("");
      setNote("");
      inputRef.current?.focus();
      void refreshHistory();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Storage</div>
          <h2 className="text-xl font-semibold">Mouvements</h2>
          <p className="text-sm text-slate-400 mt-1">
            Scan a box and choose where it is located (00 / 1 / 6 / Cabinet).
          </p>
        </div>

        <button
          onClick={refreshHistory}
          disabled={loadingHistory}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loadingHistory ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Scanner card */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Scanner</div>
            <div className="text-xs text-slate-500">USB scan, paste QR, or camera.</div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setCamError("");
                setCamOpen(true);
              }}
              className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Scan camera
            </button>

            <button
              onClick={() => {
                setRaw("");
                setNote("");
                inputRef.current?.focus();
              }}
              className="rounded-xl bg-slate-950 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Clear
            </button>
          </div>
        </div>

        <input
          ref={inputRef}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Scan/paste box QR…"
          className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
        />

        {camError ? (
          <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
            {camError}
          </div>
        ) : null}

        <div>
          <div className="text-sm font-semibold mb-2">Choose location</div>
          <div className="flex flex-wrap gap-2">
            {(["00", "1", "6", "Cabinet"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setToLoc(l)}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-semibold border",
                  toLoc === l
                    ? "bg-slate-900 border-slate-700 text-white"
                    : "bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900",
                ].join(" ")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Note (optional)</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. moved after audit"
            className="w-full border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-400 rounded-xl px-3 py-2 text-sm"
          />
        </div>

        <button
          onClick={confirmMove}
          disabled={loading || !raw.trim()}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Confirm move"}
        </button>

        {camOpen ? (
          <QrCameraModal
            onClose={() => setCamOpen(false)}
            onResult={(value) => {
              setRaw(value);
              setCamOpen(false);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
            setError={(msg) => setCamError(msg)}
          />
        ) : null}
      </div>

      {/* History card */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div className="text-sm font-semibold">History</div>
        <div className="text-xs text-slate-500">Last movements</div>

        <div className="mt-3 overflow-auto">
          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Device</th>
                <th className="p-2 text-left">Box</th>
                <th className="p-2 text-left">From</th>
                <th className="p-2 text-left">To</th>
                <th className="p-2 text-left">By</th>
                <th className="p-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-950/50">
                  <td className="p-2 border-b border-slate-800 text-slate-300">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                  </td>
                  <td className="p-2 border-b border-slate-800">{e.box?.device ?? "-"}</td>
                  <td className="p-2 border-b border-slate-800">
                    {e.box?.master_box_no ?? e.box?.box_no ?? "-"}
                  </td>
                  <td className="p-2 border-b border-slate-800">{e.from_location ?? "-"}</td>
                  <td className="p-2 border-b border-slate-800 font-semibold">{e.to_location}</td>
                  <td className="p-2 border-b border-slate-800 text-slate-400">{e.created_by_email ?? "-"}</td>
                  <td className="p-2 border-b border-slate-800 text-slate-400">{e.note ?? "-"}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3 text-sm text-slate-400">
                    No movements yet.
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

/** Camera QR modal (same idea as your outbound scan) */
function QrCameraModal({
  onClose,
  onResult,
  setError,
}: {
  onClose: () => void;
  onResult: (value: string) => void;
  setError: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera not supported on this device/browser.");
          return;
        }

        const BD = (window as any).BarcodeDetector;
        if (!BD) {
          setError("BarcodeDetector not available. Use Chrome/Edge or scan with USB scanner.");
          return;
        }

        const detector = new BD({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length > 0) {
              const rawValue = (codes[0]?.rawValue || "").trim();
              if (rawValue) {
                onResult(rawValue);
                return;
              }
            }
          } catch {
            // ignore frame errors
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.message || "Camera failed to start.");
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [onResult, setError]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Scan QR (camera)</div>
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="mt-3 rounded-xl overflow-hidden border border-slate-800 bg-black">
          <video ref={videoRef} className="w-full h-[360px] object-cover" />
        </div>

        <div className="mt-3 text-xs text-slate-400">
          Tip: if camera scan doesn’t work, use the USB scanner input field.
        </div>
      </div>
    </div>
  );
}
