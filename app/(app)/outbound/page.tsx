"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

type Preview = any;
type ConfirmResp = any;

function parseImeis(text: string) {
  const digits = (text || "").match(/\d{14,17}/g) ?? [];
  // keep order, unique
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of digits) {
    if (!seen.has(d)) {
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

export default function OutboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState<ConfirmResp | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Bulk/manual list mode (scanner down)
  const [bulkText, setBulkText] = useState("");
  const bulkImeis = useMemo(() => parseImeis(bulkText), [bulkText]);
  const [bulkPreview, setBulkPreview] = useState<any | null>(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // History
  const [events, setEvents] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    // Load outbound history
    void refreshHistory();
  }, []);

  async function refreshHistory() {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/outbound/history?limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json?.ok) setEvents(json.events ?? []);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function getUserFirstName() {
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email || "";
    return email ? email.split("@")[0] : "";
  }

  async function doPreview(payload?: string) {
    const value = (payload ?? raw).trim();
    if (!value || loadingPreview || loadingConfirm) return;

    setLoadingPreview(true);
    setPreview(null);
    setConfirm(null);

    try {
      const token = await getToken();
      if (!token) {
        setPreview({ ok: false, error: "You must be signed in." });
        return;
      }

      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ qr: value }),
      });

      const json = await res.json();
      setPreview(json);
    } catch (e: any) {
      setPreview({ ok: false, error: e?.message ?? "Preview error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function doConfirmNow() {
    const value = raw.trim();
    if (!value || loadingConfirm || loadingPreview) return;

    setLoadingConfirm(true);
    setConfirm(null);

    try {
      // ✅ On garde ton endpoint existant (ne change pas)
      const token = await getToken();
if (!token) {
  setConfirm({ ok: false, error: "Not signed in. Go to Login." });
  return;
}

const res = await fetch("/api/outbound/scan", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  // backend accepte "raw" et "qr" (on envoie les deux pour être safe)
  body: JSON.stringify({ raw: value, qr: value }),
});


      const json = await res.json();
      setConfirm(json);

      if (json?.ok) {
        toast({ kind: "success", title: "Outbound completed", message: `${json.device ?? "-"} / ${json.box_no ?? "-"}` });
        // Optimistic history entry (so UI updates even if audit table is restricted)
        const who = await getUserFirstName();
        setEvents((prev) => [
          {
            created_at: new Date().toISOString(),
            entity: json.mode === "box" ? "box" : "item",
            entity_id: json.mode === "imei" ? json.imei : json.box_id,
            payload: {
              device: json.device,
              box_no: json.box_no,
              qty: json.items_out ?? 1,
            },
            created_by_name: who || null,
          },
          ...(prev ?? []),
        ]);
        setRaw("");
        setPreview(null);
        void refreshHistory();
        setTimeout(() => inputRef.current?.focus(), 50);
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      setConfirm({ ok: false, error: e?.message ?? "Confirm error" });
      toast({ kind: "error", title: "Outbound failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
    }
  }

  async function doConfirmBulkNow() {
    const value = bulkText.trim();
    if (!value || loadingConfirm || loadingPreview) return;
    if (bulkImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Paste one IMEI per line (14–17 digits)." });
      return;
    }

    setLoadingConfirm(true);
    setConfirm(null);
    try {
      const token = await getToken();
      if (!token) {
        toast({ kind: "error", title: "Not signed in", message: "Go to Login." });
        return;
      }

      const res = await fetch("/api/outbound/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ raw: value, qr: value }),
      });

      const json = await res.json();
      setConfirm(json);

      if (json?.ok) {
        const total = json?.total_out ?? json?.items_out ?? 0;
        toast({
          kind: "success",
          title: "Outbound completed",
          message: total ? `${total} IMEI removed` : "Done",
        });
        const who = await getUserFirstName();
        setEvents((prev) => [
          {
            created_at: new Date().toISOString(),
            entity: "bulk",
            entity_id: "bulk",
            payload: {
              total_out: total,
              boxes: json?.boxes ?? [],
            },
            created_by_name: who || null,
          },
          ...(prev ?? []),
        ]);
        setBulkText("");
        void refreshHistory();
      } else {
        toast({ kind: "error", title: "Outbound failed", message: json?.error || "Unknown error" });
      }
    } catch (e: any) {
      toast({ kind: "error", title: "Outbound failed", message: e?.message ?? "Confirm error" });
    } finally {
      setLoadingConfirm(false);
    }
  }

  async function doPreviewBulkNow() {
    if (loadingPreview || loadingConfirm) return;
    if (bulkImeis.length === 0) {
      toast({ kind: "error", title: "No IMEIs found", message: "Paste one IMEI per line (14–17 digits)." });
      return;
    }

    setLoadingPreview(true);
    setBulkPreview(null);
    try {
      const token = await getToken();
      if (!token) {
        setBulkPreview({ ok: false, error: "You must be signed in." });
        return;
      }

      const res = await fetch("/api/outbound/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imeis: bulkImeis }),
      });
      const json = await res.json();
      setBulkPreview(json);
    } catch (e: any) {
      setBulkPreview({ ok: false, error: e?.message ?? "Preview error" });
    } finally {
      setLoadingPreview(false);
    }
  }

  

  const okPrev = preview && "ok" in preview && preview.ok;
  const okConf = confirm && "ok" in confirm && confirm.ok;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm outbound"
        message={
          okPrev
            ? (preview?.mode === "imei"
                ? `Remove this IMEI from stock?\n\nIMEI: ${(preview as any).imei}\nDevice: ${(preview as any).device || "-"}\nBox: ${(preview as any).box_no || "-"}`
                : `Remove this box from stock?\n\nDevice: ${(preview as any).device}\nBox: ${(preview as any).box_no}\nItems IN: ${(preview as any).items_in ?? (preview as any).imei_in ?? 0}`)
            : "Please run Preview first."
        }
        confirmText="Remove from stock"
        cancelText="Cancel"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          doConfirmNow();
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        title="Confirm outbound"
        message={
          bulkImeis.length
            ? `Remove ${bulkImeis.length} IMEI(s) from stock?\n\nFirst: ${bulkImeis.slice(0, 5).join(", ")}${bulkImeis.length > 5 ? " …" : ""}`
            : "Paste IMEIs first."
        }
        confirmText={`Remove ${bulkImeis.length || ""} IMEI(s)`}
        cancelText="Cancel"
        danger
        onCancel={() => setBulkConfirmOpen(false)}
        onConfirm={() => {
          setBulkConfirmOpen(false);
          doConfirmBulkNow();
        }}
      />
      <div>
        <div className="text-xs text-slate-500">Outbound</div>
        <h2 className="text-xl font-semibold">Outbound (USB Scanner)</h2>
        <p className="text-sm text-slate-400 mt-1">Scan → preview → confirm. No surprises.</p>
      </div>

      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
        <div className="text-sm font-semibold">Scanner</div>

        <input
          ref={inputRef}
          className="w-full rounded-lg border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-500 px-3 py-2 text-sm font-mono"
          placeholder="Click here, then scan the QR (USB scanner)"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doPreview();
          }}
        />

        <div className="flex gap-2">
          <button
            onClick={() => doPreview()}
            disabled={!raw.trim() || loadingPreview || loadingConfirm}
            className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {loadingPreview ? "..." : "Preview"}
          </button>

          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!raw.trim() || !okPrev || loadingPreview || loadingConfirm}
            className="rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            title={!okPrev ? "Run Preview first" : "Confirm outbound"}
          >
            {loadingConfirm ? "..." : "Confirm outbound"}
          </button>

          <button
            onClick={() => {
              setRaw("");
              setPreview(null);
              setConfirm(null);
              setTimeout(() => inputRef.current?.focus(), 50);
            }}
            className="rounded-md border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Manual list (scanner down) */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Manual list (multiple IMEI)</div>
            <div className="text-xs text-slate-500">Paste IMEIs (one per line) when the scanner is down.</div>
          </div>
          <div className="flex gap-2">
            <button
              className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 text-sm"
              disabled={loadingPreview || bulkImeis.length === 0}
              onClick={() => doPreviewBulkNow()}
            >
              Preview
            </button>
            <button
              className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-60"
              disabled={loadingConfirm || bulkImeis.length === 0}
              onClick={() => setBulkConfirmOpen(true)}
            >
              Remove {bulkImeis.length || ""}
            </button>
          </div>
        </div>

        <textarea
          className="w-full min-h-[120px] rounded-lg border border-slate-800 bg-slate-950 text-slate-100 placeholder:text-slate-500 px-3 py-2 text-sm font-mono"
          placeholder="Paste IMEIs here (one per line)"
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
        />

        {bulkPreview?.ok ? (
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
            <div className="font-semibold">Preview</div>
            <div className="text-slate-300 mt-1">
              Total: <b>{bulkPreview.imei_total}</b> • Found: <b>{bulkPreview.imei_found}</b> • IN: <b>{bulkPreview.imei_in}</b> • OUT: <b>{bulkPreview.imei_out}</b> • Missing: <b>{bulkPreview.imei_missing}</b>
            </div>
            {Array.isArray(bulkPreview.per_box) && bulkPreview.per_box.length > 0 ? (
              <div className="mt-2 text-xs text-slate-400">
                {bulkPreview.per_box.slice(0, 6).map((r: any) => (
                  <div key={r.box_id} className="flex justify-between">
                    <div>{r.device || "-"} / {r.box_no || "-"}</div>
                    <div>IN {r.imei_in} • OUT {r.imei_out}</div>
                  </div>
                ))}
                {bulkPreview.per_box.length > 6 ? <div className="mt-1">… +{bulkPreview.per_box.length - 6} more boxes</div> : null}
              </div>
            ) : null}
          </div>
        ) : bulkPreview?.error ? (
          <div className="text-sm text-rose-400">{bulkPreview.error}</div>
        ) : null}
      </div>

      {/* Preview */}
      {preview ? (
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <div className="text-sm font-semibold mb-3">Preview</div>
          {preview.ok ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Mode" value={String(preview.mode)} />
              {preview.mode === "imei" ? (
                <>
                  <Stat label="IMEI" value={String(preview.imei)} mono />
                  <Stat label="Item status" value={String(preview.item_status)} />
                  <Stat label="Device" value={String(preview.device ?? "-")} mono />
                  <Stat label="Box" value={String(preview.box_no ?? "-")} mono />
                </>
              ) : (
                <>
                  <Stat label="Device" value={String(preview.device)} mono />
                  <Stat label="Box" value={String(preview.box_no)} mono />
                  <Stat label="Box status" value={String(preview.box_status)} />
                  <Stat label="Items IN" value={String(preview.items_in ?? preview.imei_in ?? 0)} />
                </>
              )}
            </div>
          ) : (
            <div className="text-sm text-red-600">{String(preview.error || "Preview failed")}</div>
          )}
        </div>
      ) : null}

      {/* Outbound history */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Outbound history</div>
            <div className="text-xs text-slate-500">Latest stock-outs (box or IMEI).</div>
          </div>
          <button
            onClick={() => refreshHistory()}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            {loadingHistory ? "..." : "Refresh"}
          </button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="text-left py-2">Date</th>
                <th className="text-left py-2">User</th>
                <th className="text-left py-2">Entity</th>
                <th className="text-left py-2">Device</th>
                <th className="text-left py-2">Box</th>
                <th className="text-left py-2">Qty</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).slice(0, 100).map((e: any, idx: number) => {
                const p = e.payload || {};
                return (
                  <tr key={idx} className="border-b border-slate-900/40">
                    <td className="py-2 text-slate-200">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="py-2 text-slate-200">{e.created_by_name || "-"}</td>
                    <td className="py-2 text-slate-200">{e.entity || "-"}</td>
                    <td className="py-2 text-slate-200">
                      {p.device || (Array.isArray(p.boxes) && p.boxes.length === 1 ? p.boxes[0]?.device : "-") || "-"}
                    </td>
                    <td className="py-2 text-slate-200">
                      {p.box_no || (Array.isArray(p.boxes) ? (p.boxes.length === 1 ? p.boxes[0]?.box_no : `${p.boxes.length} boxes`) : "-") || "-"}
                    </td>
                    <td className="py-2 text-slate-200">
                      {p.qty ?? p.total_out ?? (e.entity === "item" ? 1 : "-")}
                    </td>
                  </tr>
                );
              })}
              {(!events || events.length === 0) && (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={6}>
                    No outbound events yet.
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

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function ImeiList({
  title,
  items,
  kind,
}: {
  title: string;
  items: string[];
  kind: "success" | "error" | "info";
}) {
  const tone =
    kind === "success"
      ? "border-emerald-900/60 bg-emerald-950/25"
      : kind === "error"
        ? "border-rose-900/60 bg-rose-950/25"
        : "border-slate-800 bg-slate-950/25";

  return (
    <div className={`rounded-xl border ${tone} p-3`}>
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-2 max-h-[220px] overflow-auto">
        {items.length ? (
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i} className="font-mono text-xs text-slate-200">
                {i}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-slate-500">—</div>
        )}
      </div>
    </div>
  );
}
