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

  // 🔹 Extract IMEIs
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
  // TRANSFER ENTIRE BOX
  // ================================
  async function transferWholeBox() {
    if (!boxCodeInput.trim()) {
      setMessage("❌ Box code required");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const res = await fetch("/api/transfer/box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          box_code: boxCodeInput.trim(),
          target_floor: targetFloor,
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

      {/* PREVIEW TABLE */}
      {preview?.rows && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="font-semibold mb-3">Preview</div>

          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">IMEI</th>
                <th className="p-2 text-left">From Box</th>
                <th className="p-2 text-left">From Floor</th>
                <th className="p-2 text-left">To Floor</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.imei}>
                  <td className="p-2">{r.imei}</td>
                  <td className="p-2">{r.from_box}</td>
                  <td className="p-2">{r.from_floor || "—"}</td>
                  <td className="p-2">{r.to_floor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          onClick={transferWholeBox}
          disabled={busy}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold disabled:opacity-50"
        >
          Transfer Entire Box
        </button>
      </div>

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="font-semibold">Transfer History</div>

          <select
            value={historyFilter}
            onChange={(e) =>
              setHistoryFilter(e.target.value as "all" | "today")
            }
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="today">Today</option>
          </select>
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.batch_id}>
                <td className="p-2">
                  {new Date(h.created_at).toLocaleString()}
                </td>
                <td className="p-2">{h.actor}</td>
                <td className="p-2 text-right font-semibold">
                  {h.qty}
                </td>
              </tr>
            ))}

            {history.length === 0 && (
              <tr>
                <td colSpan={3} className="p-3 text-slate-400">
                  No transfers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {loadingHistory && (
          <div className="text-xs text-slate-400">Loading…</div>
        )}
      </div>
    </div>
  );
}