"use client";

import { useEffect, useState } from "react";

type HistoryRow = {
  created_at: string;
  actor: string;
  box_id: string;
  boxes: {
    box_code: string;
    floor: string;
  };
};

export default function TransferPage() {
  const [boxCode, setBoxCode] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [preview, setPreview] = useState<any>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [searchBox, setSearchBox] = useState("");
  const [filterFloor, setFilterFloor] = useState("all");

  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ================= HISTORY =================
  async function loadHistory() {
    setLoadingHistory(true);

    const res = await fetch("/api/transfer/history", {
      cache: "no-store",
    });

    const json = await res.json();
    if (json.ok) setHistory(json.rows || []);
    setLoadingHistory(false);
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // ================= PREVIEW =================
  async function previewTransfer() {
    setBusy(true);
    setErrorMsg("");
    setPreview(null);

    const res = await fetch("/api/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ box_code: boxCode, target_floor: targetFloor }),
    });

    const json = await res.json();
    setBusy(false);

    if (json.ok) setPreview(json);
    else setErrorMsg(json.error);
  }

  // ================= CONFIRM =================
  async function confirmTransfer() {
    setBusy(true);

    const res = await fetch("/api/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        box_code: boxCode,
        target_floor: targetFloor,
        confirm: true,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (json.ok) {
      setSuccess(true);
      setPreview(null);
      await loadHistory();
      setTimeout(() => setSuccess(false), 2500);
    } else {
      setErrorMsg(json.error);
    }
  }

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString();
  }

  // ================= FILTER LOGIC =================
  const filteredHistory = history.filter((row) => {
    const matchesSearch = row.boxes?.box_code
      ?.toLowerCase()
      .includes(searchBox.toLowerCase());

    const matchesFloor =
      filterFloor === "all" ||
      row.boxes?.floor === filterFloor;

    return matchesSearch && matchesFloor;
  });

  return (
    <div className="space-y-10 max-w-5xl">

      {/* LOADER */}
      {busy && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl flex items-center gap-3 shadow-xl">
            <div className="h-5 w-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm font-semibold">Processing...</div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-xl">
          ✅ Transfer completed
        </div>
      )}

      {/* HEADER */}
      <div>
        <div className="text-xs text-slate-500">Transfer</div>
        <h2 className="text-xl font-semibold">Move Entire Box</h2>
      </div>

      {/* TRANSFER CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <input
          value={boxCode}
          onChange={(e) => setBoxCode(e.target.value)}
          placeholder="Enter box code (ex: 026-003)"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
        />

        <select
          value={targetFloor}
          onChange={(e) => setTargetFloor(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
        >
          <option value="00">Floor 00</option>
          <option value="1">Floor 1</option>
          <option value="2">Floor 2</option>
          <option value="6">Floor 6</option>
        </select>

        <button
          onClick={previewTransfer}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 font-semibold"
        >
          Preview Transfer
        </button>
      </div>

      {/* PREVIEW */}
      {preview?.preview && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
          <div>
            <b>{preview.total_items}</b> IMEIs will move
          </div>
          <div>
            From <b>{preview.current_floor}</b> → To <b>{preview.target_floor}</b>
          </div>

          <button
            onClick={confirmTransfer}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold"
          >
            Confirm Transfer
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="text-red-500 text-sm">{errorMsg}</div>
      )}

      {/* HISTORY */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">

        <div className="flex flex-wrap gap-3 justify-between items-center">
          <div className="font-semibold">Transfer History</div>

          <div className="flex flex-wrap gap-2 items-center">

            <input
              value={searchBox}
              onChange={(e) => setSearchBox(e.target.value)}
              placeholder="Search box..."
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            />

            <select
              value={filterFloor}
              onChange={(e) => setFilterFloor(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="all">All floors</option>
              <option value="00">Floor 00</option>
              <option value="1">Floor 1</option>
              <option value="2">Floor 2</option>
              <option value="6">Floor 6</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing..." : "Refresh"}
            </button>

          </div>
        </div>

        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Box</th>
              <th className="p-2 text-left">Floor</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((h, i) => (
              <tr key={i} className="hover:bg-slate-950/40">
                <td className="p-2">{fmtDate(h.created_at)}</td>
                <td className="p-2">{h.actor}</td>
                <td className="p-2 font-semibold">{h.boxes?.box_code}</td>
                <td className="p-2">{h.boxes?.floor}</td>
              </tr>
            ))}

            {filteredHistory.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-slate-400">
                  No transfers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}