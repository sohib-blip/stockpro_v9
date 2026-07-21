"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiFetch";

type HistoryRow = {
  created_at: string;
  actor: string;
  boxes: {
    box_code: string;
    floor: string;
  };
};

type BinRow = {
  id: string;
  name: string;
};

export default function TransferPage() {
  const supabase = createSupabaseBrowserClient();

  const [boxInput, setBoxInput] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [bins, setBins] = useState<BinRow[]>([]);
  const [sourceBinId, setSourceBinId] = useState("");
  const [preview, setPreview] = useState<any>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [searchBox, setSearchBox] = useState("");
  const [filterFloor, setFilterFloor] = useState("all");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);

  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function loadBins() {
    const { data, error } = await supabase
      .from("bins")
      .select("id, name, active")
      .eq("active", true)
      .order("name", { ascending: true });

    if (!error && data) {
      setBins(data as BinRow[]);
      if (!sourceBinId && data.length > 0) {
        setSourceBinId(data[0].id);
      }
    }
  }

  async function loadHistory() {
    try {
      setLoadingHistory(true);

      const res = await apiFetch("/api/transfer/history?ts=" + Date.now(), {
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
    loadBins();
  }, []);

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

    if (!sourceBinId) {
      setErrorMsg("Select a device.");
      return;
    }

    setLoadingPreview(true);

    const res = await apiFetch("/api/transfer/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        box_codes,
        source_bin_id: sourceBinId,
        target_floor: targetFloor,
      }),
    });

    const json = await res.json();
    setLoadingPreview(false);

    if (json.ok) {
      setPreview(json);
    } else {
      setErrorMsg(json.error);
    }
  }

  async function confirmTransfer() {
    const box_codes = boxInput
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);

    if (box_codes.length === 0) return;

    if (!sourceBinId) {
      setErrorMsg("Select a device.");
      return;
    }

    setLoadingConfirm(true);

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setErrorMsg("User session not found.");
      setLoadingConfirm(false);
      return;
    }

    const res = await apiFetch("/api/transfer/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        box_codes,
        source_bin_id: sourceBinId,
        target_floor: targetFloor,
      }),
    });

    const json = await res.json();
    setLoadingConfirm(false);

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
    return new Date(iso).toLocaleString("en-GB");
  }

  const filteredHistory = history.filter((row) => {
    const matchesSearch = row.boxes?.box_code
      ?.toLowerCase()
      .includes(searchBox.toLowerCase());

    const matchesFloor = filterFloor === "all" || row.boxes?.floor === filterFloor;

    return matchesSearch && matchesFloor;
  });

  return (
    <div className="prototype-page prototype-module-page transfer-prototype-page">
      {success && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-2xl shadow-xl">
          Transfer completed
        </div>
      )}

      <div className="prototype-page-header">
        <div>
        <h1>Stock Transfers</h1>
        <p>
          Move complete boxes between warehouse floors. Device stock status does not change.
        </p>
        </div>
        <button type="button" className="prototype-button secondary" onClick={() => document.getElementById("transfer-history")?.scrollIntoView({ behavior: "smooth" })}>History</button>
      </div>

      <div className="prototype-process-grid transfer-process-grid">
      <div className="prototype-process-input-column">
      <div className="prototype-input-card space-y-4">
        <div className="prototype-input-section-title">Transfer boxes</div>
        <textarea
          aria-label="Transfer box codes"
          value={boxInput}
          onChange={(e) => setBoxInput(e.target.value)}
          placeholder="Enter box codes, one per line"
          className="w-full h-28 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3"
        />

        <select
          aria-label="Transfer source device"
          value={sourceBinId}
          onChange={(e) => setSourceBinId(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
        >
          <option value="">Select device</option>
          {bins.map((bin) => (
            <option key={bin.id} value={bin.id}>
              {bin.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Transfer destination floor"
          value={targetFloor}
          onChange={(e) => setTargetFloor(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2"
        >
          <option value="00">Destination: Floor 00</option>
          <option value="1">Destination: Floor 1</option>
          <option value="6">Destination: Floor 6</option>
          <option value="Cabinet">Destination: Cabinet</option>
        </select>

        <button
          onClick={previewTransfer}
          disabled={loadingPreview}
          className="prototype-button primary grow"
        >
          {loadingPreview ? "Loading…" : "Preview Transfer"}
        </button>
      </div>
      </div>

      {preview?.preview && (
        <div className="prototype-preview-card p-6 space-y-5">
          <div className="flex justify-between items-center">
            <div className="font-semibold text-lg">Transfer Preview</div>
            <div className="text-sm text-slate-400">
              {preview.total_boxes} boxes • {preview.total_items} IMEIs
            </div>
          </div>

          <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Box</th>
                <th className="p-2 text-left">Device</th>
                <th className="p-2 text-left">Current Floor</th>
                <th className="p-2 text-right">IMEIs</th>
              </tr>
            </thead>
            <tbody>
              {preview.boxes.map((b: any, i: number) => (
                <tr key={i} className="hover:bg-slate-950/40">
                  <td className="p-2 font-semibold">{b.box_code}</td>
                  <td className="p-2">{b.device}</td>
                  <td className="p-2">{b.current_floor}</td>
                  <td className="p-2 text-right">{b.imei_count}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={confirmTransfer}
            disabled={loadingConfirm}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {loadingConfirm ? "Transferring…" : "Confirm Transfer"}
          </button>
        </div>
      )}

      {!preview?.preview && (
        <div className="prototype-empty-preview">
          <div className="prototype-empty-icon"><span /></div>
          <strong>No preview yet</strong>
          <p>Select a device bin and destination, enter complete box codes, then preview every movement before confirmation.</p>
        </div>
      )}
      </div>

      {errorMsg && <div className="text-red-500 text-sm">{errorMsg}</div>}

      <div id="transfer-history" className="prototype-card prototype-history-card space-y-4">
        <div className="flex flex-wrap gap-3 justify-between items-center">
          <div className="font-semibold">Transfer History</div>

          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={searchBox}
              onChange={(e) => setSearchBox(e.target.value)}
              placeholder="Search by box code"
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
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto border border-slate-800 rounded-xl">
          <table className="w-full text-sm">
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
    </div>
  );
}
