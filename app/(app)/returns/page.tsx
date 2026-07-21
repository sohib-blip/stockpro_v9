"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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
      const res = await fetch(`/api/returns/history?page=${page}&t=${Date.now()}`, {
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
      return new Date(iso).toLocaleString("fr-BE");
    } catch {
      return iso;
    }
  }

  async function previewReturn() {
    setBusy(true);
    setMsg("");
    setPreview(null);

    try {
      const res = await fetch("/api/returns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imeisText }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMsg("❌ " + (json.error || "Preview failed"));
        return;
      }

      setPreview(json);
    } catch (e: any) {
      setMsg("❌ " + (e?.message || "Preview failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    if (!preview?.valid_returns?.length) {
      setMsg("❌ No valid returns to confirm.");
      return;
    }

    if (!returnType) {
      setMsg("❌ Return type required.");
      return;
    }

    if (!returnReason) {
      setMsg("❌ Return reason required.");
      return;
    }

    if (!targetBox.trim()) {
      setMsg("❌ Target box required.");
      return;
    }

    setBusy(true);
    setMsg("");

    try {
      const res = await fetch("/api/returns/confirm", {
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
        setMsg("❌ " + (json.error || "Confirm failed"));
        return;
      }

      setMsg(`✅ Return saved: ${json.returned} IMEIs returned to stock.`);
      setPreview(null);
      setImeisText("");
      setReturnRef("");
      setReturnType("");
      setReturnReason("");

      await loadHistory();
    } catch (e: any) {
      setMsg("❌ " + (e?.message || "Confirm failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="sp-card sp-card-tight text-sm font-semibold text-sp-text">
            Processing...
          </div>
        </div>
      )}

      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Returns</div>
          <h1 className="sp-title">Customer Return</h1>
          <p className="sp-desc">
            User: <b>{actor}</b>
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="sp-card space-y-4">
          <div className="font-semibold text-sp-text">Return information</div>

          <input
            value={returnRef}
            onChange={(e) => setReturnRef(e.target.value)}
            placeholder="Return reference / customer / note"
            className="sp-input"
          />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              value={returnType}
              onChange={(e) => {
                setReturnType(e.target.value);
                setReturnReason("");
              }}
              className="sp-select"
            >
              <option value="">Choose return type</option>
              <option value="cancellation_stop">Cancellation stop</option>
              <option value="technical_stop">Technical stop</option>
            </select>

            {returnType && (
              <select
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="sp-select"
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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              value={targetBox}
              onChange={(e) => setTargetBox(e.target.value)}
              placeholder="Target return box, ex: RETURN-001"
              className="sp-input"
            />

            <select
              value={targetFloor}
              onChange={(e) => setTargetFloor(e.target.value)}
              className="sp-select"
            >
              <option value="00">Floor 00</option>
              <option value="1">Floor 1</option>
              <option value="6">Floor 6</option>
              <option value="Cabinet">Cabinet</option>
            </select>
          </div>

          <textarea
            value={imeisText}
            onChange={(e) => setImeisText(e.target.value)}
            placeholder="Scan or paste returned IMEIs here, one per line"
            className="sp-textarea h-40"
          />

          <button
            onClick={previewReturn}
            disabled={busy}
            className="sp-btn sp-btn-primary"
          >
            Preview Return
          </button>
        </div>

        {msg && (
          <div
            className={`sp-alert ${msg.startsWith("✅") ? "sp-alert-ok" : "sp-alert-err"}`}
          >
            {msg}
          </div>
        )}

        {preview?.ok && (
          <div className="sp-card space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-semibold text-sp-text">Return Preview</div>
              <div className="text-sm text-sp-muted">
                Scanned: {preview.total_scanned}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="sp-card sp-card-tight">
                <div className="sp-badge sp-badge-ok">Valid returns</div>
                <div className="sp-kpi-value">{preview.valid_returns.length}</div>
              </div>

              <div className="sp-card sp-card-tight">
                <div className="sp-badge sp-badge-low">Already in stock</div>
                <div className="sp-kpi-value">{preview.already_in_stock.length}</div>
              </div>

              <div className="sp-card sp-card-tight">
                <div className="sp-badge sp-badge-empty">Unknown IMEI</div>
                <div className="sp-kpi-value">{preview.unknown_imeis.length}</div>
              </div>
            </div>

            {preview.valid_returns?.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-sp-text">Return details</div>

                <div className="overflow-x-auto rounded-lg border border-sp-border">
                  <table className="sp-table">
                    <thead>
                      <tr>
                        <th>IMEI</th>
                        <th>Device / Bin</th>
                        <th>Previous box</th>
                        <th>Previous floor</th>
                        <th>Return type</th>
                        <th>Reason</th>
                        <th>Target box</th>
                        <th>Target floor</th>
                      </tr>
                    </thead>

                    <tbody>
                      {preview.valid_returns.map((item: any) => (
                        <tr key={item.imei}>
                          <td>{item.imei}</td>
                          <td className="font-semibold text-sp-primary">{item.device}</td>
                          <td>{item.previous_box || "-"}</td>
                          <td>{item.previous_floor || "-"}</td>
                          <td>{returnType || "-"}</td>
                          <td>{returnReason || "-"}</td>
                          <td>{targetBox || "-"}</td>
                          <td>{targetFloor || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(preview.already_in_stock?.length > 0 ||
              preview.unknown_imeis?.length > 0) && (
              <div className="sp-alert sp-alert-warn space-y-2 text-xs">
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

            <div className="flex flex-wrap gap-3">
              <button
                onClick={confirmReturn}
                disabled={busy || preview.valid_returns.length === 0}
                className="sp-btn sp-btn-primary"
              >
                Confirm Return
              </button>

              <button
                onClick={() => {
                  setPreview(null);
                  setMsg("");
                }}
                disabled={busy}
                className="sp-btn sp-btn-ghost"
              >
                Cancel Preview
              </button>
            </div>
          </div>
        )}

        <div className="sp-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-sp-text">Returns history</div>
              <div className="text-xs text-sp-muted">
                All customer returns with reason and export
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <a href="/api/returns/export" className="sp-btn sp-btn-ghost">
                Export all returns
              </a>

              <button onClick={loadHistory} className="sp-btn sp-btn-ghost">
                {loadingHistory ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-x-auto overflow-y-auto rounded-lg border border-sp-border">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Ref</th>
                  <th className="text-right">Qty</th>
                </tr>
              </thead>

              <tbody>
                {history.map((h) => (
                  <tr key={h.operation_id}>
                    <td>{fmtDateTime(h.created_at)}</td>
                    <td>{h.actor}</td>
                    <td>{h.return_type || "-"}</td>
                    <td>{h.return_reason || "-"}</td>
                    <td>{h.return_ref || "-"}</td>
                    <td className="text-right font-semibold">{h.qty}</td>
                  </tr>
                ))}

                {history.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-sp-muted">
                      No returns yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="sp-btn sp-btn-ghost"
            >
              Previous
            </button>

            <div className="text-sm text-sp-muted">Page {page}</div>

            <button
              onClick={() => setPage((p) => p + 1)}
              className="sp-btn sp-btn-ghost"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
