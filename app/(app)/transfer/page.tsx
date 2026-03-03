"use client";

import { useEffect, useState } from "react";

type HistoryRow = {
  created_at: string;
  actor: string;
  boxes: {
    box_code: string;
    floor: string;
  };
};

export default function TransferPage() {
  const [boxInput, setBoxInput] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [preview, setPreview] = useState<any>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [searchBox, setSearchBox] = useState("");
  const [filterFloor, setFilterFloor] = useState("all");

  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ================= HISTORY =================
  async function loadHistory() {
    try {
      setLoadingHistory(true);

      const res = await fetch("/api/transfer/history", {
        cache: "no-store",
      });

      const json = await res.json();

      if (json.ok) setHistory(json.rows || []);
      else setHistory([]);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  // ================= PREVIEW =================
  async function previewTransfer() {
  setErrorMsg("");
  setPreview(null);

  const box_codes = boxInput
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  if (box_codes.length === 0) {
    setErrorMsg("Enter at least one box code.");
    return;
  }

  const res = await fetch("/api/transfer/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      box_codes,
      target_floor: targetFloor,
    }),
  });

  const json = await res.json();

  if (json.ok) {
    setPreview(json);
  } else {
    setErrorMsg(json.error);
  }
}

  // ================= CONFIRM =================
  async function confirmTransfer() {
  const box_codes = boxInput
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);

  const res = await fetch("/api/transfer/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      box_codes,
      target_floor: targetFloor,
    }),
  });

  const json = await res.json();

  if (json.ok) {
    setSuccess(true);
    setPreview(null);
    setBoxInput("");
    await loadHistory();
    setTimeout(() => setSuccess(false), 2500);
  } else {
    setErrorMsg(json.error);
  }
}

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString();
  }

  // ================= FILTER =================
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

      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-xl">
          ✅ Transfer completed
        </div>
      )}

      <div>
        <div className="text-xs text-slate-500">Transfer</div>
        <h2 className="text-xl font-semibold">Move Multiple Boxes</h2>
      </div>

      {/* TRANSFER CARD */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">

        <textarea
          value={boxInput}
          onChange={(e) => setBoxInput(e.target.value)}
          placeholder="Enter box codes (1 per line)"
          className="w-full h-28 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3"
        />

        <select
          value={targetFloor}
          onChange={(e) => setTargetFloor(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
        >
          <option value="00">Floor 00</option>
          <option value="1">Floor 1</option>
          <option value="6">Floor 6</option>
          <option value="Cabinet">Cabinet</option>
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
            <b>{preview.total_boxes}</b> boxes will move
          </div>
          <div>
            <b>{preview.total_items}</b> IMEIs total
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
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
            >
              <option value="all">All floors</option>
              <option value="00">Floor 00</option>
              <option value="1">Floor 1</option>
              <option value="6">Floor 6</option>
              <option value="Cabinet">Cabinet</option>
            </select>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Refresh
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