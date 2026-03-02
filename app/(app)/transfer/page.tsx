"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PreviewRow = {
  imei: string;
  from_box: string;
  from_floor: string | null;
  to_floor: string;
  box_code: string;
  bin_id: string;
  item_id: string;
};

export default function TransferPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState("");

  // IMEI transfer
  const [imeiInput, setImeiInput] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [preview, setPreview] = useState<{
    ok: boolean;
    rows: PreviewRow[];
    payload: any[];
    target_floor: string;
  } | null>(null);

  // Box transfer
  const [boxCodeInput, setBoxCodeInput] = useState("");
  const [boxPreview, setBoxPreview] = useState<any>(null);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // History
  const [history, setHistory] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "today">("all");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 🔹 Load user
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      const id = data?.user?.id;
      if (email) setActor(email);
      if (id) setActorId(id);
    })();
  }, [supabase]);

  function extractImeis(text: string): string[] {
    return Array.from(
      new Set(
        text
          .split(/\s+/g)
          .map((x) => x.replace(/\D/g, ""))
          .filter((x) => x.length === 15)
      )
    );
  }

  // ================================
  // PREVIEW IMEI TRANSFER
  // ================================
  async function previewTransfer() {
    setMessage("");
    setPreview(null);

    const imeis = extractImeis(imeiInput);

    if (!imeis.length) {
      setMessage("❌ No valid IMEIs detected.");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/transfer/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imeis, target_floor: targetFloor }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMessage("❌ " + json.error);
        return;
      }

      setPreview(json);
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Preview failed"));
    } finally {
      setBusy(false);
    }
  }

  // ================================
  // CONFIRM IMEI TRANSFER
  // ================================
  async function confirmTransfer() {
    if (!preview?.payload) return;

    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/transfer/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: preview.payload,
          target_floor: preview.target_floor,
          actor,
          actor_id: actorId,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMessage("❌ " + json.error);
        return;
      }

      setMessage(`✅ ${json.moved} IMEIs moved to floor ${targetFloor}`);
      setPreview(null);
      setImeiInput("");
      loadHistory();
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Transfer failed"));
    } finally {
      setBusy(false);
    }
  }

  // ================================
  // PREVIEW BOX TRANSFER (NEW)
  // ================================
  async function previewBoxTransfer() {
    setMessage("");
    setBoxPreview(null);

    if (!boxCodeInput.trim()) {
      setMessage("❌ Box code required");
      return;
    }

    setBusy(true);

    try {
      const res = await fetch("/api/transfer/box-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          box_code: boxCodeInput.trim(),
          target_floor: targetFloor,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMessage("❌ " + json.error);
        return;
      }

      setBoxPreview(json);
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Box preview failed"));
    } finally {
      setBusy(false);
    }
  }

  // ================================
  // CONFIRM BOX TRANSFER (UPDATED)
  // ================================
  async function confirmBoxTransfer() {
    if (!boxPreview) return;

    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/transfer/box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          box_code: boxPreview.box_code,
          target_floor: boxPreview.to_floor,
          actor,
          actor_id: actorId,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMessage("❌ " + json.error);
        return;
      }

      setMessage(`✅ Entire box moved (${json.moved} IMEIs)`);
      setBoxPreview(null);
      setBoxCodeInput("");
      loadHistory();
    } catch (e: any) {
      setMessage("❌ " + (e?.message || "Box transfer failed"));
    } finally {
      setBusy(false);
    }
  }

  // ================================
  // HISTORY
  // ================================
  async function loadHistory() {
    setLoadingHistory(true);

    const res = await fetch(
      `/api/transfer/history?filter=${historyFilter}`,
      { cache: "no-store" }
    );

    const json = await res.json();

    if (json.ok) setHistory(json.rows);
    else setHistory([]);

    setLoadingHistory(false);
  }

  useEffect(() => {
    loadHistory();
  }, [historyFilter]);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <div className="text-xs text-slate-500">Transfer</div>
        <h2 className="text-xl font-semibold">
          Move IMEIs Between Floors
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          User: <b>{actor}</b>
        </p>
      </div>

      {/* IMEI TRANSFER */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="font-semibold">Transfer Specific IMEIs</div>

        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          placeholder="Scan or paste IMEIs (15 digits)"
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />

        <select
          value={targetFloor}
          onChange={(e) => setTargetFloor(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="00">Floor 00</option>
          <option value="1">Floor 1</option>
          <option value="6">Floor 6</option>
          <option value="Cabinet">Cabinet</option>
        </select>

        <div className="flex gap-2">
          <button
            onClick={previewTransfer}
            disabled={busy}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Preview
          </button>

          <button
            onClick={confirmTransfer}
            disabled={!preview || busy}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Confirm
          </button>
        </div>

        {message && (
          <div className="text-sm text-slate-300">{message}</div>
        )}
      </div>

      {/* BOX TRANSFER */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div>
          <div className="font-semibold">Transfer Entire Box</div>
          <div className="text-xs text-slate-500">
            Move all IN IMEIs from one box to another floor.
          </div>
        </div>

        <input
          value={boxCodeInput}
          onChange={(e) => setBoxCodeInput(e.target.value)}
          placeholder="Enter box code"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        <button
          onClick={previewBoxTransfer}
          disabled={busy}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-50"
        >
          Preview Box Transfer
        </button>

        {boxPreview && (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
            <div>
              <b>{boxPreview.total}</b> IMEIs will move
            </div>
            <div>
              From floor <b>{boxPreview.from_floor}</b> → To floor{" "}
              <b>{boxPreview.to_floor}</b>
            </div>

            <button
              onClick={confirmBoxTransfer}
              disabled={busy}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold"
            >
              Confirm Box Transfer
            </button>
          </div>
        )}
      </div>

      {/* HISTORY (unchanged) */}
      ...
    </div>
  );
}