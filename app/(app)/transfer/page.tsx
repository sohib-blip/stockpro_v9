"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function TransferPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState("");

  const [imeiInput, setImeiInput] = useState("");
  const [targetBox, setTargetBox] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [message, setMessage] = useState("");

  const [history, setHistory] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "today">("all");
  const [loadingHistory, setLoadingHistory] = useState(false);

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

  async function previewTransfer() {
    setMessage("");
    setPreview(null);

    const imeis = extractImeis(imeiInput);
    if (!imeis.length) return setMessage("❌ No valid IMEIs");
    if (!targetBox.trim()) return setMessage("❌ Target box required");

    const res = await fetch("/api/transfer/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imeis, box_code: targetBox }),
    });

    const json = await res.json();
    if (!json.ok) {
      setMessage("❌ " + json.error);
      return;
    }

    setPreview(json);
  }

  async function confirmTransfer() {
    if (!preview?.payload) return;

    const res = await fetch("/api/transfer/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_ids: preview.payload.item_ids,
        target_box_id: preview.payload.target_box_id,
        actor,
        actor_id: actorId,
      }),
    });

    const json = await res.json();

    if (!json.ok) {
      setMessage("❌ " + json.error);
      return;
    }

    setMessage(`✅ ${json.moved} IMEIs transferred`);
    setPreview(null);
    setImeiInput("");
    setTargetBox("");
    loadHistory();
  }

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
        <h2 className="text-xl font-semibold">Move IMEIs</h2>
      </div>

      {/* INPUT */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          placeholder="Scan or paste IMEIs"
          className="w-full h-32 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />

        <input
          value={targetBox}
          onChange={(e) => setTargetBox(e.target.value)}
          placeholder="Target box code"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        <div className="flex gap-2">
          <button
            onClick={previewTransfer}
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
          >
            Preview
          </button>

          <button
            onClick={confirmTransfer}
            disabled={!preview}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            Confirm Transfer
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
                <th className="p-2 text-left">To Box</th>
                <th className="p-2 text-left">To Floor</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r: any) => (
                <tr key={r.imei}>
                  <td className="p-2">{r.imei}</td>
                  <td className="p-2">{r.from_box}</td>
                  <td className="p-2">{r.from_floor || "—"}</td>
                  <td className="p-2">{r.to_box}</td>
                  <td className="p-2">{r.to_floor || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="font-semibold">Transfer history</div>

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