"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

      const res = await fetch("/api/transfer/history?ts=" + Date.now(), {
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

    const res = await fetch("/api/transfer/preview", {
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

    const res = await fetch("/api/transfer/confirm", {
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
    return new Date(iso).toLocaleString();
  }

  const filteredHistory = history.filter((row) => {
    const matchesSearch = row.boxes?.box_code
      ?.toLowerCase()
      .includes(searchBox.toLowerCase());

    const matchesFloor = filterFloor === "all" || row.boxes?.floor === filterFloor;

    return matchesSearch && matchesFloor;
  });

  return (
    <div className="w-full">
      {success && (
        <div className="sp-alert sp-alert-ok fixed bottom-6 right-6 z-40">
          ✅ Transfer completed
        </div>
      )}

      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Transfer</div>
          <h1 className="sp-title">Move Multiple Boxes</h1>
        </div>
      </div>

      <div className="space-y-6">
        <div className="sp-card space-y-4">
          <textarea
            value={boxInput}
            onChange={(e) => setBoxInput(e.target.value)}
            placeholder="Enter box codes (1 per line)"
            className="sp-textarea h-28"
          />

          <select
            value={sourceBinId}
            onChange={(e) => setSourceBinId(e.target.value)}
            className="sp-select"
          >
            <option value="">Select device</option>
            {bins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.name}
              </option>
            ))}
          </select>

          <select
            value={targetFloor}
            onChange={(e) => setTargetFloor(e.target.value)}
            className="sp-select"
          >
            <option value="00">To Floor 00</option>
            <option value="1">To Floor 1</option>
            <option value="6">To Floor 6</option>
            <option value="Cabinet">To Cabinet</option>
          </select>

          <button
            onClick={previewTransfer}
            disabled={loadingPreview}
            className="sp-btn sp-btn-primary"
          >
            {loadingPreview ? "Loading..." : "Preview Transfer"}
          </button>
        </div>

        {preview?.preview && (
          <div className="sp-card space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-semibold text-sp-text">Transfer Preview</div>
              <div className="text-sm text-sp-muted">
                {preview.total_boxes} boxes • {preview.total_items} IMEIs
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-sp-border">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>Box</th>
                    <th>Device</th>
                    <th>Current Floor</th>
                    <th className="text-right">IMEIs</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.boxes.map((b: any, i: number) => (
                    <tr key={i}>
                      <td className="font-semibold">{b.box_code}</td>
                      <td>{b.device}</td>
                      <td>{b.current_floor}</td>
                      <td className="text-right">{b.imei_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={confirmTransfer}
              disabled={loadingConfirm}
              className="sp-btn sp-btn-primary"
            >
              {loadingConfirm ? "Transferring..." : "Confirm Transfer"}
            </button>
          </div>
        )}

        {errorMsg && <div className="sp-alert sp-alert-err">{errorMsg}</div>}

        <div className="sp-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-semibold text-sp-text">Transfer History</div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={searchBox}
                onChange={(e) => setSearchBox(e.target.value)}
                placeholder="Search box..."
                className="sp-input max-w-xs"
              />

              <select
                value={filterFloor}
                onChange={(e) => setFilterFloor(e.target.value)}
                className="sp-select w-auto"
              >
                <option value="all">All floors</option>
                <option value="00">Floor 00</option>
                <option value="1">Floor 1</option>
                <option value="6">Floor 6</option>
                <option value="Cabinet">Cabinet</option>
              </select>

              <button onClick={loadHistory} className="sp-btn sp-btn-ghost">
                {loadingHistory ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-x-auto overflow-y-auto rounded-lg border border-sp-border">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Box</th>
                  <th>Floor</th>
                </tr>
              </thead>

              <tbody>
                {filteredHistory.map((h, i) => (
                  <tr key={i}>
                    <td>{fmtDate(h.created_at)}</td>
                    <td>{h.actor}</td>
                    <td className="font-semibold">{h.boxes?.box_code}</td>
                    <td>{h.boxes?.floor}</td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-sp-muted">
                      No transfers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
