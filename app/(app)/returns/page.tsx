"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";

const cancellationReasons = [
  "Lack of Radius accuracy",
  "Poor customer experience",
  "Incorrect solution for customer",
  "Hardware error",
  "Implementation error",
  "Dispatch warehouse error",
  "Price dissatisfaction",
  "Don't see value",
  "Product inadequacy",
  "Customer's circumstance changed",
  "Dissatisfaction with Radius Group",
  "Other",
];

const technicalReasons = [
  "Return to sender",
  "Faulty unit",
  "Wrong device",
  "Damaged unit in transit",
  "Damaged unit by customer",
  "Lost in post",
  "Vehicle lost",
  "Vehicle sold",
];

export default function ReturnsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState("");

  const [returnRef, setReturnRef] = useState("");
  const [returnType, setReturnType] = useState("");
  const [returnReason, setReturnReason] = useState("");

  const [targetBox, setTargetBox] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [imeisText, setImeisText] = useState("");

  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setActor(data.user.email);
      if (data?.user?.id) setActorId(data.user.id);
    })();
  }, [supabase]);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function loadHistory() {
    setLoadingHistory(true);

    try {
      const res = await apiFetch(`/api/returns/history?page=${page}&t=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });

      const json = await res.json();

      if (json.ok) setHistory(json.rows || []);
      else setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString("en-GB");
    } catch {
      return iso;
    }
  }

  async function previewReturn() {
    setBusy(true);
    setMsg("");
    setPreview(null);

    try {
      const res = await apiFetch("/api/returns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imeisText }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMsg(json.error || "Return preview failed");
        return;
      }

      setPreview(json);
    } catch (e: any) {
      setMsg(e?.message || "Return preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    if (!preview?.valid_returns?.length) {
      setMsg("No valid returns are available to confirm.");
      return;
    }

    if (!returnType) {
      setMsg("Select a return type.");
      return;
    }

    if (!returnReason) {
      setMsg("Select a return reason.");
      return;
    }

    if (!targetBox.trim()) {
      setMsg("Enter a destination box.");
      return;
    }

    setBusy(true);
    setMsg("");

    try {
      const res = await apiFetch("/api/returns/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: preview.valid_returns,
          target_box: targetBox.trim(),
          target_floor: targetFloor,
          return_ref: returnRef || null,
          return_type: returnType,
          return_reason: returnReason,
          actor,
          actor_id: actorId,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMsg(json.error || "Return confirmation failed");
        return;
      }

      setMsg(`Return completed: ${json.returned} IMEIs returned to stock.`);
      setPreview(null);
      setImeisText("");
      setReturnRef("");
      setReturnType("");
      setReturnReason("");

      await loadHistory();
    } catch (e: any) {
      setMsg(e?.message || "Return confirmation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prototype-page prototype-module-page returns-prototype-page">
      {busy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl shadow-xl">
            Processing…
          </div>
        </div>
      )}

      <div className="prototype-page-header">
        <div>
        <h1>Customer Returns</h1>
        <p>
          Return previously outbound devices to stock. Devices become IN at the target location.
        </p>
        </div>
        <button type="button" className="prototype-button secondary" onClick={() => document.getElementById("returns-history")?.scrollIntoView({ behavior: "smooth" })}>History &amp; exports</button>
      </div>

      <div className="prototype-process-grid returns-process-grid">
      <div className="prototype-process-input-column">
      <div className="prototype-input-card space-y-4">
        <div className="prototype-input-section-title">Return information</div>

        <input
          aria-label="Return reference"
          value={returnRef}
          onChange={(e) => setReturnRef(e.target.value)}
          placeholder="Return reference / customer / note"
          className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            aria-label="Return type"
            value={returnType}
            onChange={(e) => {
              setReturnType(e.target.value);
              setReturnReason("");
            }}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="">Choose return type</option>
            <option value="cancellation_stop">Cancellation stop</option>
            <option value="technical_stop">Technical stop</option>
          </select>

          {returnType && (
            <select
              aria-label="Return reason"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">Choose reason</option>
              {(returnType === "cancellation_stop"
                ? cancellationReasons
                : technicalReasons
              ).map((reason) => (
                <option key={reason} value={reason}>
                  {reason}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            aria-label="Return target box"
            value={targetBox}
            onChange={(e) => setTargetBox(e.target.value)}
            placeholder="Target return box, ex: RETURN-001"
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          />

          <select
            aria-label="Return target floor"
            value={targetFloor}
            onChange={(e) => setTargetFloor(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="00">Floor 00</option>
            <option value="1">Floor 1</option>
            <option value="6">Floor 6</option>
            <option value="Cabinet">Cabinet</option>
          </select>
        </div>

        <textarea
          aria-label="Returned IMEIs"
          value={imeisText}
          onChange={(e) => setImeisText(e.target.value)}
          placeholder="Scan or paste returned IMEIs here, one per line"
          className="w-full h-40 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm"
        />

        <button
          onClick={previewReturn}
          disabled={busy}
          className="prototype-button primary grow"
        >
          Preview Return
        </button>
      </div>

      {msg && (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
          {msg}
        </div>
      )}
      </div>

      {preview?.ok && (
        <div className="prototype-preview-card p-6 space-y-5">
          <div className="flex justify-between items-center">
            <div className="font-semibold">Return Preview</div>
            <div className="text-sm text-slate-400">
              Scanned: {preview.total_scanned}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4">
              <div className="text-xs text-emerald-300">Valid returns</div>
              <div className="text-3xl font-bold">{preview.valid_returns.length}</div>
            </div>

            <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4">
              <div className="text-xs text-amber-300">Already in stock</div>
              <div className="text-3xl font-bold">{preview.already_in_stock.length}</div>
            </div>

            <div className="rounded-xl border border-red-800 bg-red-950/30 p-4">
              <div className="text-xs text-red-300">Unknown IMEI</div>
              <div className="text-3xl font-bold">{preview.unknown_imeis.length}</div>
            </div>
          </div>

          {preview.valid_returns?.length > 0 && (
            <div>
              <div className="font-semibold mb-2">Return details</div>

              <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
                <thead className="bg-slate-950/50">
                  <tr>
                    <th className="p-2 text-left">IMEI</th>
                    <th className="p-2 text-left">Device / Bin</th>
                    <th className="p-2 text-left">Previous box</th>
                    <th className="p-2 text-left">Previous floor</th>
                    <th className="p-2 text-left">Return type</th>
                    <th className="p-2 text-left">Reason</th>
                    <th className="p-2 text-left">Target box</th>
                    <th className="p-2 text-left">Target floor</th>
                  </tr>
                </thead>

                <tbody>
                  {preview.valid_returns.map((item: any) => (
                    <tr key={item.imei} className="border-t border-slate-800">
                      <td className="p-2">{item.imei}</td>
                      <td className="p-2 font-semibold text-cyan-400">{item.device}</td>
                      <td className="p-2">{item.previous_box || "-"}</td>
                      <td className="p-2">{item.previous_floor || "-"}</td>
                      <td className="p-2">{returnType || "-"}</td>
                      <td className="p-2">{returnReason || "-"}</td>
                      <td className="p-2">{targetBox || "-"}</td>
                      <td className="p-2">{targetFloor || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(preview.already_in_stock?.length > 0 || preview.unknown_imeis?.length > 0) && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs space-y-2">
              {preview.already_in_stock?.length > 0 && (
                <div>
                  <b>Already in stock:</b> {preview.already_in_stock.join(", ")}
                </div>
              )}
              {preview.unknown_imeis?.length > 0 && (
                <div>
                  <b>Unknown IMEI:</b> {preview.unknown_imeis.join(", ")}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={confirmReturn}
              disabled={busy || preview.valid_returns.length === 0}
              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Confirm Return
            </button>

            <button
              onClick={() => {
                setPreview(null);
                setMsg("");
              }}
              disabled={busy}
              className="rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800 px-4 py-2 font-semibold disabled:opacity-50"
            >
              Cancel Preview
            </button>
          </div>
        </div>
      )}

      {!preview?.ok && (
        <div className="prototype-empty-preview">
          <div className="prototype-empty-icon"><span /></div>
          <strong>No preview yet</strong>
          <p>Choose the return reason and target location, paste the returned IMEIs, then preview their classification before confirmation.</p>
        </div>
      )}
      </div>

      <div id="returns-history" className="prototype-card prototype-history-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Returns History</div>
            <div className="text-xs text-slate-500">
              All customer returns with reason and export
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() =>
                downloadApiFile("/api/returns/export", "returns.xlsx").catch(
                  (error) => setMsg(error.message)
                )
              }
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              Export all returns
            </button>

            <button
              onClick={loadHistory}
              className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
            >
              {loadingHistory ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto border border-slate-800 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-950/50">
              <tr>
                <th className="p-2 text-left">Date and Time</th>
                <th className="p-2 text-left">User</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Reason</th>
                <th className="p-2 text-left">Reference</th>
                <th className="p-2 text-right">Quantity</th>
              </tr>
            </thead>

            <tbody>
              {history.map((h) => (
                <tr key={h.operation_id} className="border-t border-slate-800">
                  <td className="p-2">{fmtDateTime(h.created_at)}</td>
                  <td className="p-2">{h.actor}</td>
                  <td className="p-2">{h.return_type || "-"}</td>
                  <td className="p-2">{h.return_reason || "-"}</td>
                  <td className="p-2">{h.return_ref || "-"}</td>
                  <td className="p-2 text-right font-semibold">{h.qty}</td>
                </tr>
              ))}

              {history.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-slate-400">
                    No returns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-slate-800 px-4 py-2 text-sm hover:bg-slate-800"
          >
            Previous
          </button>

          <div className="text-sm text-slate-400">Page {page}</div>

          <button
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-slate-800 px-4 py-2 text-sm hover:bg-slate-800"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
