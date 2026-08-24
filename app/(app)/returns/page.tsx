"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";
import ProcessFeedback, { type ProcessFeedbackKind } from "@/components/ProcessFeedback";
import {
  RETURN_COUNTRIES,
  RETURN_COURIERS,
  RETURN_FALLBACK_DEVICE_MODELS,
  RETURN_REASONS,
  RETURN_STATUSES,
  extractReturnImeis,
  matchReturnDeviceOption,
  mergeReturnDeviceOptions,
  returnCountryLabel,
  returnCourierLabel,
  returnStatusLabel,
  returnStockActionLabel,
  type ReturnStatus,
} from "@/lib/returns";

type PreviewItem = {
  item_id: string | null;
  imei: string;
  device: string;
  previous_box: string;
  previous_floor: string;
  return_status: ReturnStatus;
  stock_action: "added_to_stock" | "no_stock_change";
  inventory_match: "known" | "unknown";
  reported_device: string | null;
};

type ReturnDeviceGroup = {
  id: string;
  reportedDevice: string;
  imeisText: string;
};

const INITIAL_RETURN_DEVICE_GROUP: ReturnDeviceGroup = {
  id: "return-device-group-1",
  reportedDevice: "",
  imeisText: "",
};

type ReturnPreview = {
  ok: true;
  total_scanned: number;
  valid_returns: PreviewItem[];
  already_in_stock: string[];
  unknown_imeis: string[];
  return_status: ReturnStatus;
  stock_action: "added_to_stock" | "no_stock_change";
};

type HistoryBatch = {
  history_key: string;
  operation_id: string | null;
  created_at: string;
  actor: string;
  return_ref: string;
  return_reason: string;
  item_count: number;
  customer: string;
  sur_id: string;
  courier: string;
  country_code: string;
  return_status: ReturnStatus;
  device_summary: string;
  device_count: number;
  stock_action: "added_to_stock" | "no_stock_change" | "mixed";
};

type HistoryDetailRow = {
  id: string;
  operation_id: string;
  created_at: string;
  actor: string;
  return_ref: string;
  return_reason: string;
  customer: string;
  sur_id: string;
  courier: string;
  country_code: string;
  return_status: ReturnStatus;
  device: string;
  imei: string;
  previous_box: string;
  previous_floor: string;
  target_box: string | null;
  target_floor: string | null;
  stock_action: "added_to_stock" | "no_stock_change";
};

export default function ReturnsPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [actorId, setActorId] = useState("");
  const [returnRef, setReturnRef] = useState("");
  const [courier, setCourier] = useState("DHL");
  const [countryCode, setCountryCode] = useState("BE");
  const [customer, setCustomer] = useState("");
  const [surId, setSurId] = useState("");
  const [returnStatus, setReturnStatus] =
    useState<ReturnStatus>("available");
  const [returnDeviceGroups, setReturnDeviceGroups] = useState<
    ReturnDeviceGroup[]
  >([{ ...INITIAL_RETURN_DEVICE_GROUP }]);
  const [deviceOptions, setDeviceOptions] = useState<string[]>(() =>
    mergeReturnDeviceOptions([...RETURN_FALLBACK_DEVICE_MODELS])
  );
  const [returnReason, setReturnReason] = useState("");
  const [targetBox, setTargetBox] = useState("");
  const [targetFloor, setTargetFloor] = useState("00");
  const [imeisText, setImeisText] = useState("");

  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [reviewedFingerprint, setReviewedFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<ProcessFeedbackKind>("error");

  const [history, setHistory] = useState<HistoryBatch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyCursorStack, setHistoryCursorStack] = useState<
    Array<string | null>
  >([]);
  const [nextHistoryCursor, setNextHistoryCursor] = useState<string | null>(
    null
  );
  const [historySearch, setHistorySearch] = useState("");
  const [historyMonth, setHistoryMonth] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyCourier, setHistoryCourier] = useState("");

  function showReturnError(message: string) {
    setMsgKind("error");
    setMsg(message);
  }

  function showReturnSuccess(message: string) {
    setMsgKind("success");
    setMsg(message);
  }

  function showReturnInfo(message: string) {
    setMsgKind("info");
    setMsg(message);
  }
  const [historyCountry, setHistoryCountry] = useState("");
  const [pendingTemplateReturns, setPendingTemplateReturns] = useState(0);
  const [templateExportBusy, setTemplateExportBusy] = useState(false);
  const [selectedHistoryBatch, setSelectedHistoryBatch] =
    useState<HistoryBatch | null>(null);
  const [historyDetails, setHistoryDetails] = useState<HistoryDetailRow[]>([]);
  const [loadingHistoryDetails, setLoadingHistoryDetails] = useState(false);
  const [historyDetailsError, setHistoryDetailsError] = useState("");
  const returnOperationIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.email) setActor(data.user.email);
      if (data?.user?.id) setActorId(data.user.id);
    })();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch("/api/returns/devices", {
          method: "GET",
          cache: "no-store",
        });
        const json = await response.json();
        if (!cancelled && json.ok) {
          setDeviceOptions(
            mergeReturnDeviceOptions([
              ...RETURN_FALLBACK_DEVICE_MODELS,
              ...(json.devices || []),
            ])
          );
        }
      } catch {
        if (!cancelled) {
          setDeviceOptions(
            mergeReturnDeviceOptions([...RETURN_FALLBACK_DEVICE_MODELS])
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadTemplateExportStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedHistoryBatch) return;

    function closeHistoryDialog(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedHistoryBatch(null);
    }

    document.addEventListener("keydown", closeHistoryDialog);
    return () => document.removeEventListener("keydown", closeHistoryDialog);
  }, [selectedHistoryBatch]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => loadHistory(historyCursor),
      historySearch ? 250 : 0
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    historyCursor,
    historySearch,
    historyMonth,
    historyStatus,
    historyCourier,
    historyCountry,
  ]);

  function returnLines() {
    return returnDeviceGroups.flatMap((group) =>
      extractReturnImeis(group.imeisText).map((imei) => ({
        imei,
        reported_device: group.reportedDevice.trim(),
      }))
    );
  }

  function updateReturnDeviceGroup(
    id: string,
    patch: Partial<Pick<ReturnDeviceGroup, "reportedDevice" | "imeisText">>
  ) {
    setReturnDeviceGroups((groups) =>
      groups.map((group) =>
        group.id === id ? { ...group, ...patch } : group
      )
    );
    setPreview(null);
    setReviewedFingerprint("");
  }

  function addReturnDeviceGroup() {
    setReturnDeviceGroups((groups) => [
      ...groups,
      {
        id: crypto.randomUUID(),
        reportedDevice: "",
        imeisText: "",
      },
    ]);
    setPreview(null);
    setReviewedFingerprint("");
  }

  function removeReturnDeviceGroup(id: string) {
    setReturnDeviceGroups((groups) => {
      const next = groups.filter((group) => group.id !== id);
      return next.length > 0 ? next : [{ ...INITIAL_RETURN_DEVICE_GROUP }];
    });
    setPreview(null);
    setReviewedFingerprint("");
  }

  function formFingerprint() {
    return JSON.stringify({
      returnRef: returnRef.trim(),
      courier,
      countryCode,
      customer: customer.trim(),
      surId: surId.trim(),
      returnStatus,
      deviceGroups:
        returnStatus === "available"
          ? null
          : returnDeviceGroups.map((group) => ({
              reportedDevice: group.reportedDevice.trim(),
              imeis: extractReturnImeis(group.imeisText),
            })),
      returnReason,
      targetBox: returnStatus === "available" ? targetBox.trim() : null,
      targetFloor: returnStatus === "available" ? targetFloor : null,
      imeisText: imeisText.trim(),
    });
  }

  function validateRequiredInformation() {
    if (!returnRef.trim()) return "Enter a return reference.";
    if (!courier) return "Select a courier.";
    if (!countryCode) return "Select a country.";
    if (!customer.trim()) return "Enter the customer name.";
    if (!surId.trim()) return "Enter the SUR ID.";
    if (!returnStatus) return "Select a return status.";
    if (!returnReason) return "Select a return reason.";
    if (returnStatus === "available" && !imeisText.trim()) {
      return "Scan or paste at least one returned IMEI.";
    }
    if (returnStatus !== "available") {
      const populatedGroups = returnDeviceGroups.filter(
        (group) => group.reportedDevice.trim() || group.imeisText.trim()
      );
      if (populatedGroups.length === 0) {
        return "Add at least one returned device and IMEI.";
      }
      for (const [index, group] of populatedGroups.entries()) {
        if (!group.reportedDevice.trim()) {
          return `Select the device for group ${index + 1}.`;
        }
        if (!matchReturnDeviceOption(group.reportedDevice, deviceOptions)) {
          return `Select a valid device for group ${index + 1}.`;
        }
        if (extractReturnImeis(group.imeisText).length === 0) {
          return `Scan or paste at least one valid IMEI for group ${index + 1}.`;
        }
      }
      const lines = returnLines();
      if (new Set(lines.map((line) => line.imei)).size !== lines.length) {
        return "The same IMEI cannot appear in more than one device group.";
      }
      if (lines.length > 500) {
        return "A maximum of 500 IMEIs can be returned at once.";
      }
    }
    if (returnStatus === "available" && !targetBox.trim()) {
      return "Enter a destination box for Available returns.";
    }
    if (returnStatus === "available" && !targetFloor) {
      return "Select a destination floor for Available returns.";
    }
    return "";
  }

  async function loadHistory(cursor: string | null = historyCursor) {
    setLoadingHistory(true);
    try {
      const query = new URLSearchParams({
        t: String(Date.now()),
        search: historySearch,
        month: historyMonth,
        status: historyStatus,
        courier: historyCourier,
        country: historyCountry,
      });
      if (cursor) query.set("cursor", cursor);

      const response = await apiFetch(
        `/api/returns/history?${query.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        }
      );
      const json = await response.json();
      if (json.ok) {
        setHistory(json.rows || []);
        setNextHistoryCursor(json.next_cursor || null);
      } else {
        setHistory([]);
        setNextHistoryCursor(null);
      }
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadTemplateExportStatus() {
    try {
      const response = await apiFetch("/api/returns/template-export/status", {
        method: "GET",
        cache: "no-store",
      });
      const json = await response.json();
      if (json.ok) setPendingTemplateReturns(Number(json.pending || 0));
    } catch {
      // History remains usable when the optional export counter is unavailable.
    }
  }

  async function downloadNewReturns() {
    setTemplateExportBusy(true);
    setMsg("");
    try {
      await downloadApiFile(
        "/api/returns/template-export",
        "multi-device-returns.xlsx"
      );
      showReturnInfo(
        `${pendingTemplateReturns} new return${
          pendingTemplateReturns === 1 ? "" : "s"
        } exported. The next download will contain only later returns.`
      );
      await loadTemplateExportStatus();
    } catch (error: any) {
      showReturnError(error?.message || "New returns export failed");
      await loadTemplateExportStatus();
    } finally {
      setTemplateExportBusy(false);
    }
  }

  async function downloadReturnOperation(operationId: string) {
    setMsg("");
    try {
      await downloadApiFile(
        `/api/returns/template-export?operation_id=${encodeURIComponent(
          operationId
        )}`,
        "multi-device-returns-operation.xlsx"
      );
      showReturnInfo("Return operation Excel download started.");
    } catch (error: any) {
      showReturnError(error?.message || "Return operation export failed");
    }
  }

  async function openHistoryBatch(batch: HistoryBatch) {
    if (!batch.operation_id) return;
    setSelectedHistoryBatch(batch);
    setHistoryDetails([]);
    setHistoryDetailsError("");
    setLoadingHistoryDetails(true);
    try {
      const response = await apiFetch(
        `/api/returns/history?operation_id=${encodeURIComponent(
          batch.operation_id
        )}`,
        { method: "GET", cache: "no-store" }
      );
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Return operation details failed");
      }
      setHistoryDetails(json.rows || []);
    } catch (error: any) {
      setHistoryDetailsError(
        error?.message || "Return operation details failed"
      );
    } finally {
      setLoadingHistoryDetails(false);
    }
  }

  function resetHistoryPagination() {
    setHistoryCursorStack([]);
    setHistoryCursor(null);
  }

  function formatDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/Brussels",
      });
    } catch {
      return iso;
    }
  }

  async function previewReturn() {
    setMsg("");
    const validationError = validateRequiredInformation();
    if (validationError) {
      setPreview(null);
      showReturnError(validationError);
      return;
    }

    setBusy(true);
    setPreview(null);
    setReviewedFingerprint("");
    returnOperationIdRef.current = null;
    try {
      const response = await apiFetch("/api/returns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imeisText: returnStatus === "available" ? imeisText : "",
          lines: returnStatus === "available" ? undefined : returnLines(),
          return_status: returnStatus,
        }),
      });
      const json = await response.json();
      if (!json.ok) {
        showReturnError(json.error || "Return preview failed");
        return;
      }
      setPreview(json);
      setReviewedFingerprint(formFingerprint());
    } catch (error: any) {
      showReturnError(error?.message || "Return preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    if (!preview?.valid_returns?.length) {
      showReturnError("No valid returns are available to confirm.");
      return;
    }
    if (reviewedFingerprint !== formFingerprint()) {
      showReturnError("Return details changed. Preview the return again before confirming.");
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      const operationId =
        returnOperationIdRef.current || crypto.randomUUID();
      returnOperationIdRef.current = operationId;
      const response = await apiFetch("/api/returns/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: operationId,
          items: preview.valid_returns,
          target_box: returnStatus === "available" ? targetBox.trim() : null,
          target_floor: returnStatus === "available" ? targetFloor : null,
          return_ref: returnRef.trim(),
          return_reason: returnReason,
          return_status: returnStatus,
          courier,
          country_code: countryCode,
          customer: customer.trim(),
          sur_id: surId.trim(),
          actor,
          actor_id: actorId,
        }),
      });
      const json = await response.json();
      if (!json.ok) {
        showReturnError(json.error || "Return confirmation failed");
        return;
      }

      showReturnSuccess(
        returnStatus === "available"
          ? `Return completed: ${json.added_to_stock} IMEIs added to stock.`
          : `${returnStatusLabel(returnStatus)} return recorded: ${json.logged_only} IMEIs logged with no stock change.`
      );
      setPreview(null);
      setReviewedFingerprint("");
      setImeisText("");
      setReturnRef("");
      setCustomer("");
      setSurId("");
      setReturnReason("");
      setReturnDeviceGroups([{ ...INITIAL_RETURN_DEVICE_GROUP }]);
      setTargetBox("");
      returnOperationIdRef.current = null;
      setHistoryCursorStack([]);
      setHistoryCursor(null);
      await Promise.all([loadHistory(null), loadTemplateExportStatus()]);
    } catch (error: any) {
      showReturnError(error?.message || "Return confirmation failed");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = returnStatusLabel(returnStatus);
  const addsToStock = returnStatus === "available";

  return (
    <div className="prototype-page prototype-module-page returns-prototype-page">
      {busy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-slate-950 border border-slate-800 px-6 py-4 rounded-2xl shadow-xl">
            Processing…
          </div>
        </div>
      )}

      {selectedHistoryBatch && (
        <div
          className="returns-history-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setSelectedHistoryBatch(null);
            }
          }}
        >
          <section
            className="returns-history-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="returns-history-dialog-title"
          >
            <div className="returns-history-dialog-header">
              <div>
                <span>Return operation</span>
                <h2 id="returns-history-dialog-title">
                  {selectedHistoryBatch.return_ref || "Return batch"}
                </h2>
                <p>
                  {selectedHistoryBatch.item_count} returned IMEI
                  {selectedHistoryBatch.item_count === 1 ? "" : "s"} · {" "}
                  {formatDateTime(selectedHistoryBatch.created_at)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close return operation details"
                onClick={() => setSelectedHistoryBatch(null)}
              >
                ×
              </button>
            </div>

            <div className="returns-history-dialog-summary">
              <div>
                <span>Customer</span>
                <strong>{selectedHistoryBatch.customer || "—"}</strong>
              </div>
              <div>
                <span>SUR ID</span>
                <strong>{selectedHistoryBatch.sur_id || "—"}</strong>
              </div>
              <div>
                <span>Courier</span>
                <strong>
                  {returnCourierLabel(selectedHistoryBatch.courier)}
                </strong>
              </div>
              <div>
                <span>Country</span>
                <strong>
                  {returnCountryLabel(selectedHistoryBatch.country_code) || "—"}
                </strong>
              </div>
              <div>
                <span>Reason</span>
                <strong>{selectedHistoryBatch.return_reason || "—"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{returnStatusLabel(selectedHistoryBatch.return_status)}</strong>
              </div>
              <div>
                <span>Processed by</span>
                <strong>{selectedHistoryBatch.actor || "unknown"}</strong>
              </div>
            </div>

            <div className="returns-history-dialog-toolbar">
              <div>
                <strong>IMEI details</strong>
                <span>Device and stock location for every returned unit.</span>
              </div>
              {selectedHistoryBatch.operation_id && (
                <button
                  type="button"
                  className="prototype-button secondary"
                  onClick={() =>
                    downloadReturnOperation(selectedHistoryBatch.operation_id as string)
                  }
                >
                  Re-download Excel
                </button>
              )}
            </div>

            <div className="returns-history-dialog-table-scroll">
              {loadingHistoryDetails ? (
                <div className="returns-history-dialog-state">Loading operation details…</div>
              ) : historyDetailsError ? (
                <div className="returns-history-dialog-state is-error">
                  {historyDetailsError}
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>IMEI</th>
                      <th>Device</th>
                      <th>Status</th>
                      <th>Previous location</th>
                      <th>Destination</th>
                      <th>Stock action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyDetails.map((detail) => (
                      <tr key={detail.id}>
                        <td>{detail.imei}</td>
                        <td>{detail.device || "—"}</td>
                        <td>{returnStatusLabel(detail.return_status)}</td>
                        <td>
                          {[
                            detail.previous_box,
                            detail.previous_floor
                              ? `Floor ${detail.previous_floor}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td>
                          {[
                            detail.target_box,
                            detail.target_floor
                              ? `Floor ${detail.target_floor}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td>{returnStockActionLabel(detail.stock_action)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="prototype-page-header">
        <div>
          <h1>Customer Returns</h1>
          <p>Register, classify and track every customer return.</p>
        </div>
        <button
          type="button"
          className="prototype-button secondary"
          onClick={() =>
            document
              .getElementById("returns-history")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          History &amp; exports
        </button>
      </div>

      {msg && (
        <ProcessFeedback
          kind={msgKind}
          title={
            msgKind === "success"
              ? "Return operation completed"
              : msgKind === "info"
                ? "Return export ready"
                : "Return action blocked"
          }
          message={msg}
          onDismiss={() => setMsg("")}
        />
      )}

      <div className="prototype-process-grid returns-process-grid">
        <div className="prototype-process-input-column returns-input-column">
          <div className="prototype-input-card">
            <div className="prototype-input-section-title">
              Return information
            </div>
            <div className="returns-automatic-date-note">
              Return date and time are recorded automatically on confirmation.
            </div>

            <div className="returns-form-grid">
              <label>
                Return reference <b>*</b>
                <input
                  aria-label="Return reference"
                  value={returnRef}
                  onChange={(event) => setReturnRef(event.target.value)}
                  placeholder="e.g. RMA-20260811-0001"
                />
              </label>

              <label>
                Courier <b>*</b>
                <select
                  aria-label="Return courier"
                  value={courier}
                  onChange={(event) => setCourier(event.target.value)}
                >
                  {RETURN_COURIERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Country <b>*</b>
                <select
                  aria-label="Return country"
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                >
                  {RETURN_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Customer <b>*</b>
                <input
                  aria-label="Customer"
                  value={customer}
                  onChange={(event) => setCustomer(event.target.value)}
                  placeholder="Customer name"
                />
              </label>

              <label>
                SUR ID <b>*</b>
                <input
                  aria-label="SUR ID"
                  value={surId}
                  onChange={(event) => setSurId(event.target.value)}
                  placeholder="e.g. SUR-20260811-0157"
                />
              </label>

              <label>
                Return status <b>*</b>
                <select
                  aria-label="Return status"
                  value={returnStatus}
                  onChange={(event) => {
                    setReturnStatus(event.target.value as ReturnStatus);
                    setPreview(null);
                    setReviewedFingerprint("");
                  }}
                >
                  {RETURN_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Return reason <b>*</b>
                <select
                  aria-label="Return reason"
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                >
                  <option value="">Choose reason</option>
                  {RETURN_REASONS.map((reason) => (
                    <option key={reason.controlCode} value={reason.value}>
                      {reason.value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {addsToStock ? (
              <label className="returns-imei-field">
                Returned IMEIs <b>*</b>
                <span>
                  scan or paste a bulk list — devices are detected automatically
                </span>
                <textarea
                  aria-label="Returned IMEIs"
                  value={imeisText}
                  onChange={(event) => setImeisText(event.target.value)}
                  placeholder="Scan or paste returned IMEIs here"
                />
              </label>
            ) : (
              <section
                className="returns-device-groups"
                aria-labelledby="returns-device-groups-title"
              >
                <div className="returns-device-groups-heading">
                  <div>
                    <strong id="returns-device-groups-title">
                      Returned devices <b>*</b>
                    </strong>
                    <span>
                      Create one group per model, then scan or paste all matching
                      IMEIs.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="prototype-button secondary"
                    onClick={addReturnDeviceGroup}
                  >
                    + Add another device
                  </button>
                </div>

                <datalist id="return-device-model-options">
                  {deviceOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>

                <div className="returns-device-group-list">
                  {returnDeviceGroups.map((group, index) => {
                    const scanned = extractReturnImeis(group.imeisText).length;
                    return (
                      <div className="returns-device-group" key={group.id}>
                        <div className="returns-device-group-header">
                          <strong>Device group {index + 1}</strong>
                          {returnDeviceGroups.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeReturnDeviceGroup(group.id)}
                              aria-label={`Remove device group ${index + 1}`}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="returns-device-group-fields">
                          <label>
                            Device model <b>*</b>
                            <input
                              aria-label={
                                index === 0
                                  ? "Return device"
                                  : `Return device ${index + 1}`
                              }
                              list="return-device-model-options"
                              autoComplete="off"
                              value={group.reportedDevice}
                              onChange={(event) =>
                                updateReturnDeviceGroup(group.id, {
                                  reportedDevice: event.target.value,
                                })
                              }
                              placeholder="Search or select a device…"
                            />
                          </label>
                          <label className="returns-imei-field">
                            Returned IMEIs <b>*</b>
                            <span>{scanned} scanned</span>
                            <textarea
                              aria-label={
                                index === 0
                                  ? "Returned IMEIs"
                                  : `Returned IMEIs ${index + 1}`
                              }
                              value={group.imeisText}
                              onChange={(event) =>
                                updateReturnDeviceGroup(group.id, {
                                  imeisText: event.target.value,
                                })
                              }
                              placeholder="Scan one IMEI per line or paste a bulk list"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {addsToStock && (
              <div className="returns-destination-panel">
                <strong>
                  Stock destination — required for Available returns
                </strong>
                <div className="returns-form-grid">
                  <label>
                    Target box <b>*</b>
                    <input
                      aria-label="Return target box"
                      value={targetBox}
                      onChange={(event) => setTargetBox(event.target.value)}
                      placeholder="e.g. RET-BOX-07"
                    />
                  </label>
                  <label>
                    Target floor <b>*</b>
                    <select
                      aria-label="Return target floor"
                      value={targetFloor}
                      onChange={(event) => setTargetFloor(event.target.value)}
                    >
                      <option value="00">Floor 00</option>
                      <option value="1">Floor 1</option>
                      <option value="6">Floor 6</option>
                      <option value="Cabinet">Cabinet</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={previewReturn}
              disabled={busy}
              className="prototype-button primary returns-preview-button"
            >
              Preview Return
            </button>
          </div>

        </div>

        {preview?.ok ? (
          <div className="prototype-preview-card returns-preview-card">
            <div className="prototype-preview-content">
              <div className="prototype-preview-heading">
                <div className="font-semibold">Return Preview</div>
              </div>

              <div className="returns-preview-summary">
                <div>
                  <span>Scanned</span>
                  <strong>{preview.total_scanned}</strong>
                </div>
                <div>
                  <span>Valid</span>
                  <strong>{preview.valid_returns.length}</strong>
                </div>
                <div>
                  <span>{addsToStock ? "Will be added to stock" : "Logged only"}</span>
                  <strong>{preview.valid_returns.length}</strong>
                </div>
              </div>

              <div
                className={`returns-policy-banner ${
                  addsToStock ? "is-available" : "is-no-stock"
                }`}
              >
                <strong>{statusLabel}</strong>
                <span>
                  {addsToStock
                    ? "These devices will be returned to stock."
                    : "These devices will be recorded only; stock remains unchanged."}
                </span>
              </div>

              <div className="returns-policy-reminder">
                Only Available returns affect inventory. Damaged, Disposed and
                Returned — Unprocessed returns remain outside stock.
              </div>

              {preview.valid_returns.length > 0 && (
                <div className="prototype-preview-table-scroll is-wide returns-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>IMEI</th>
                        <th>Device</th>
                        <th>Previous location</th>
                        <th>Status</th>
                        <th>Stock action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.valid_returns.map((item) => (
                        <tr key={item.imei}>
                          <td>{item.imei}</td>
                          <td>{item.device}</td>
                          <td>
                            {item.inventory_match === "unknown"
                              ? "Not in inventory"
                              : [item.previous_box, item.previous_floor]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                          </td>
                          <td>
                            <span
                              className={`returns-status-badge is-${returnStatus}`}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`returns-stock-action ${
                                addsToStock ? "is-added" : "is-unchanged"
                              }`}
                            >
                              {addsToStock ? "Add to stock" : "No stock change"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(preview.already_in_stock.length > 0 ||
                preview.unknown_imeis.length > 0) && (
                <div className="returns-preview-exceptions">
                  {preview.already_in_stock.length > 0 && (
                    <div>
                      <b>Already in stock:</b>{" "}
                      {preview.already_in_stock.join(", ")}
                    </div>
                  )}
                  {preview.unknown_imeis.length > 0 && (
                    <div>
                      <b>Unknown IMEI:</b> {preview.unknown_imeis.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="prototype-preview-actions returns-preview-actions">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setReviewedFingerprint("");
                  setMsg("");
                }}
                disabled={busy}
                className="prototype-button secondary"
              >
                Cancel Preview
              </button>
              <button
                type="button"
                aria-label="Confirm Return"
                onClick={confirmReturn}
                disabled={busy || preview.valid_returns.length === 0}
                className="prototype-button confirm"
              >
                Confirm {preview.valid_returns.length} {statusLabel} Returns
              </button>
            </div>
          </div>
        ) : (
          <div className="prototype-empty-preview returns-empty-preview">
            <div className="prototype-empty-icon">
              <span />
            </div>
            <strong>No preview yet</strong>
            <p>
              Complete all required information and paste the returned IMEIs.
              Every stock action will be shown before confirmation.
            </p>
          </div>
        )}
      </div>

      <div
        id="returns-history"
        className="prototype-card prototype-history-card returns-history-card"
      >
        <div className="returns-history-heading">
          <div>
            <div className="font-semibold">Returns History</div>
            <div className="text-xs text-slate-500">
              One auditable row per return operation. Select a row to inspect
              every returned IMEI.
            </div>
          </div>
          <div className="returns-history-export-actions">
            <div className="returns-new-export-control">
              <button
                type="button"
                onClick={downloadNewReturns}
                disabled={templateExportBusy || pendingTemplateReturns === 0}
                className="prototype-button primary"
              >
                {templateExportBusy ? (
                  "Preparing…"
                ) : (
                  <>
                    <span>Download new returns</span>
                    <span aria-hidden="true">({pendingTemplateReturns})</span>
                  </>
                )}
              </button>
              <span>Only returns not downloaded before.</span>
            </div>
            <button
              type="button"
              onClick={() =>
                downloadApiFile(
                  "/api/returns/export",
                  "stockpro_returns_export.xlsx"
                ).catch((error) => showReturnError(error.message))
              }
              className="prototype-button secondary"
            >
              Detailed export
            </button>
          </div>
        </div>

        <div className="returns-history-filters">
          <input
            aria-label="Search returns history"
            value={historySearch}
            onChange={(event) => {
              setHistorySearch(event.target.value);
              resetHistoryPagination();
            }}
            placeholder="Search reference, SUR ID, customer, device or IMEI"
          />
          <input
            aria-label="Returns history month"
            type="month"
            value={historyMonth}
            onChange={(event) => {
              setHistoryMonth(event.target.value);
              resetHistoryPagination();
            }}
          />
          <select
            aria-label="Returns history status"
            value={historyStatus}
            onChange={(event) => {
              setHistoryStatus(event.target.value);
              resetHistoryPagination();
            }}
          >
            <option value="">Status: All</option>
            {RETURN_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Returns history courier"
            value={historyCourier}
            onChange={(event) => {
              setHistoryCourier(event.target.value);
              resetHistoryPagination();
            }}
          >
            <option value="">Courier: All</option>
            {RETURN_COURIERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Returns history country"
            value={historyCountry}
            onChange={(event) => {
              setHistoryCountry(event.target.value);
              resetHistoryPagination();
            }}
          >
            <option value="">Country: All</option>
            {RETURN_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </div>

        <div className="returns-history-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Return date</th>
                <th>Reference</th>
                <th>SUR ID</th>
                <th>Customer</th>
                <th>Courier</th>
                <th>Country</th>
                <th>Device summary</th>
                <th>IMEIs</th>
                <th>Status</th>
                <th>Stock action</th>
                <th>User</th>
                <th>Excel</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr
                  key={row.history_key}
                  className={row.operation_id ? "is-clickable" : ""}
                  tabIndex={row.operation_id ? 0 : undefined}
                  onClick={() => openHistoryBatch(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openHistoryBatch(row);
                    }
                  }}
                >
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.return_ref || "—"}</td>
                  <td>{row.sur_id || "—"}</td>
                  <td>{row.customer || "—"}</td>
                  <td>{returnCourierLabel(row.courier)}</td>
                  <td>{returnCountryLabel(row.country_code) || "—"}</td>
                  <td>{row.device_summary || "—"}</td>
                  <td>
                    <strong>{row.item_count}</strong>
                  </td>
                  <td>
                    <span
                      className={`returns-status-badge is-${row.return_status}`}
                    >
                      {returnStatusLabel(row.return_status)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`returns-stock-action ${
                        row.stock_action === "added_to_stock"
                          ? "is-added"
                          : "is-unchanged"
                      }`}
                    >
                      {row.stock_action === "mixed"
                        ? "Mixed stock actions"
                        : returnStockActionLabel(row.stock_action)}
                    </span>
                  </td>
                  <td>{row.actor || "unknown"}</td>
                  <td>
                    {row.operation_id ? (
                      <button
                        type="button"
                        className="returns-operation-export-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          downloadReturnOperation(row.operation_id as string);
                        }}
                      >
                        Re-download
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={12} className="returns-history-empty">
                    {loadingHistory ? "Loading…" : "No returns found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="returns-history-pagination">
          <button
            type="button"
            disabled={historyCursorStack.length === 0}
            onClick={() => {
              const previous =
                historyCursorStack[historyCursorStack.length - 1] ?? null;
              setHistoryCursorStack((current) => current.slice(0, -1));
              setHistoryCursor(previous);
            }}
            className="prototype-button secondary"
          >
            Previous
          </button>
          <span>Page {historyCursorStack.length + 1}</span>
          <button
            type="button"
            disabled={!nextHistoryCursor}
            onClick={() => {
              if (!nextHistoryCursor) return;
              setHistoryCursorStack((current) => [
                ...current,
                historyCursor,
              ]);
              setHistoryCursor(nextHistoryCursor);
            }}
            className="prototype-button secondary"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
