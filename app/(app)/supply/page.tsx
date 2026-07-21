"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";

const OFFICES = [
  { code: "BE", label: "🇧🇪 Belgium" },
  { code: "UK", label: "🇬🇧 United Kingdom" },
  { code: "NL", label: "🇳🇱 Netherlands" },
  { code: "DE", label: "🇩🇪 Germany" },
  { code: "FR", label: "🇫🇷 France" },
  { code: "ES", label: "🇪🇸 Spain" },
  { code: "IE", label: "🇮🇪 Ireland" },
  { code: "PT", label: "🇵🇹 Portugal" },
  { code: "IT", label: "🇮🇹 Italy" },
];

const STATUS = [
  "CREATED",
  "SHIPPED",
  "RECEIVED",
  "IMPORTED",
  "FAILED",
] as const;

type SupplyItem = {
  product_id?: string | null;
  product_type: "DEVICE" | "ACCESSORY";
  product_name: string;
  qty: number;
};

export default function SupplyPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [userEmail, setUserEmail] = useState("unknown");
  const [userId, setUserId] = useState<string | null>(null);

  const [rows, setRows] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [accessories, setAccessories] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
const [sortKey, setSortKey] = useState("created_at");
const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
const [page, setPage] = useState(1);
const pageSize = 20;

  const [openModal, setOpenModal] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [fromOffice, setFromOffice] = useState("UK");
  const [toOffice, setToOffice] = useState("BE");
  const [tracking, setTracking] = useState("");
  const [failedReason, setFailedReason] = useState("");
  const [status, setStatus] = useState<
  "CREATED" | "SHIPPED" | "RECEIVED" | "IMPORTED" | "FAILED"
>("CREATED");
  const [comment, setComment] = useState("");

  const [items, setItems] = useState<SupplyItem[]>([
    { product_type: "DEVICE", product_name: "", qty: 1 },
  ]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [detailTarget, setDetailTarget] = useState<any | null>(null);
  const [statusHistory, setStatusHistory] = useState<any[]>([]);

  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    if (data.user?.email) setUserEmail(data.user.email);
    if (data.user?.id) setUserId(data.user.id);
  }

  async function loadSupply() {
  const res = await fetch(`/api/supply/list?t=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
    },
  });

  const json = await res.json();

  if (json.ok) {
    setRows([]);
    setTimeout(() => {
      setRows(json.rows || []);
    }, 0);
  }
}

async function loadProducts() {
  const [deviceRes, accessoryRes] = await Promise.all([
    fetch(`/api/dashboard/bins?t=${Date.now()}`, { cache: "no-store" }),
    fetch(`/api/accessory-bins/list?t=${Date.now()}`, { cache: "no-store" }),
  ]);

  const deviceJson = await deviceRes.json();
  const accessoryJson = await accessoryRes.json();

  if (deviceJson.ok) setDevices(deviceJson.rows || []);
  if (accessoryJson.ok) setAccessories(accessoryJson.rows || []);
}

function productOptions(type: "DEVICE" | "ACCESSORY") {
  if (type === "DEVICE") {
    return devices.map((d: any) => d.device).filter(Boolean);
  }

  return accessories.map((a: any) => a.name).filter(Boolean);
}

  useEffect(() => {
  loadUser();
  loadSupply();
  loadProducts();
}, []);

  function officeLabel(code: string) {
    return OFFICES.find((o) => o.code === code)?.label || code;
  }

  function officeFlag(code: string) {
    return officeLabel(code).split(" ")[0] || code;
  }

  function resetForm() {
    setEditing(null);
    setFromOffice("UK");
    setToOffice("BE");
    setTracking("");
    setFailedReason("");
    setStatus("CREATED");
    setComment("");
    setItems([{ product_type: "DEVICE", product_name: "", qty: 1 }]);
  }

  function openCreate() {
    resetForm();
    setOpenModal(true);
  }

function availableStatuses(
  currentStatus: string
): Array<(typeof STATUS)[number]> {
  switch (currentStatus) {
    case "CREATED":
      return ["CREATED", "SHIPPED", "FAILED"];

    case "SHIPPED":
      return ["SHIPPED", "RECEIVED", "FAILED"];

    case "RECEIVED":
      return ["RECEIVED", "IMPORTED", "FAILED"];

    case "IMPORTED":
      return ["IMPORTED"];

    case "FAILED":
      return ["FAILED"];

    default:
      return [...STATUS];
  }
}
  function openEdit(row: any) {
    setEditing(row);
    setFromOffice(row.from_office || "UK");
    setToOffice(row.to_office || "BE");
    setTracking(row.tracking_number || "");
    setFailedReason(row.failed_reason || "");
    setStatus(row.status || "CREATED");
    setComment(row.comment || "");
    setItems(
      row.supply_items?.length
        ? row.supply_items.map((i: any) => ({
            product_id: i.product_id,
            product_type: i.product_type,
            product_name: i.product_name,
            qty: i.qty,
          }))
        : [{ product_type: "DEVICE", product_name: "", qty: 1 }]
    );
    setOpenModal(true);
  }

  function updateItem(index: number, patch: Partial<SupplyItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { product_type: "DEVICE", product_name: "", qty: 1 },
    ]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveSupply(forceDone = false) {
  if (editing && status === "IMPORTED" && editing.status !== "IMPORTED" && !forceDone) {
    setConfirmDone(true);
    return;
  }

  if (editing && status === "FAILED" && !failedReason.trim()) {
  setMsg("Please enter a failure reason.");
  return;
}

  setBusy(true);
  setMsg("");

  const payload = editing
  ? {
      id: editing.id,
      status,
      tracking_number: tracking || editing.tracking_number || null,
      failed_reason: status === "FAILED" ? failedReason : null,
      changed_by: userEmail,
      changed_by_id: userId,
    }
  : {
      from_office: fromOffice,
      to_office: toOffice,
      status: "CREATED",
      comment,
      created_by: userEmail,
      created_by_id: userId,
      items: items.filter(
        (i) => i.product_name.trim() && Number(i.qty) > 0
      ),
    };

  const res = await fetch(
    editing ? "/api/supply/update" : "/api/supply/create",
    {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const json = await res.json();
  setBusy(false);

  if (!json.ok) {
    setMsg(json.error || "Save failed");
    return;
  }

  setOpenModal(false);
setConfirmDone(false);

await loadSupply();

setDetailTarget(null);
setStatusHistory([]);

resetForm();
}

  const filteredRows = rows.filter((row) => {
    const q = search.toLowerCase();

    const matchesSearch =
  row.order_number?.toLowerCase().includes(q) ||
  row.tracking_number?.toLowerCase().includes(q) ||
  row.from_office?.toLowerCase().includes(q) ||
  row.to_office?.toLowerCase().includes(q) ||
  (row.supply_items || []).some((i: any) =>
    i.product_name?.toLowerCase().includes(q)
  );

    const matchesStatus =
      statusFilter === "ALL" || row.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

function sortBy(key: string) {
  if (sortKey === key) {
    setSortDir(sortDir === "asc" ? "desc" : "asc");
  } else {
    setSortKey(key);
    setSortDir("asc");
  }

  setPage(1);
}

const sortedRows = [...filteredRows].sort((a, b) => {
  const aValue = a[sortKey] || "";
  const bValue = b[sortKey] || "";

  return sortDir === "asc"
    ? String(aValue).localeCompare(String(bValue), undefined, { numeric: true })
    : String(bValue).localeCompare(String(aValue), undefined, { numeric: true });
});

const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

const paginatedRows = sortedRows.slice(
  (page - 1) * pageSize,
  page * pageSize
);

  const kpis = {
    total: rows.length,
    created: rows.filter((r) => r.status === "CREATED").length,
    shipped: rows.filter((r) => r.status === "SHIPPED").length,
received: rows.filter((r) => r.status === "RECEIVED").length,
    imported: rows.filter((r) => r.imported).length,
    failed: rows.filter((r) => r.status === "FAILED").length,
  };

    function statusClass(status: string) {
  if (status === "FAILED")
    return "sp-badge-err";

  if (status === "IMPORTED")
    return "sp-badge-ok";

  if (status === "RECEIVED")
    return "sp-badge-info";

  if (status === "SHIPPED")
    return "sp-badge-low";

  return "sp-badge-neutral";
}

  function formatDate(value?: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString("fr-BE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function totalQty(row: any) {
    return (row.supply_items || []).reduce(
      (sum: number, item: any) => sum + Number(item.qty || 0),
      0
    );
  }

async function openDetails(row: any) {
  setDetailTarget(row);
  setStatusHistory([]);
  setMsg("");

  try {
    const res = await fetch(
      `/api/supply/history?id=${encodeURIComponent(row.id)}&t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      }
    );

    const json = await res.json();

    if (!res.ok || !json.ok) {
      setMsg(json.error || "Could not load status history");
      return;
    }

    setStatusHistory(json.rows ?? []);
  } catch (error) {
    console.error("OPEN SUPPLY DETAILS ERROR:", error);
    setMsg("Could not load status history");
  }
}

  async function deleteSupply() {
  if (!deleteTarget) return;

  setBusy(true);
  setMsg("");

  const res = await fetch("/api/supply/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: deleteTarget.id }),
  });

  const json = await res.json();
  setBusy(false);

  if (!json.ok) {
    setMsg(json.error || "Delete failed");
    return;
  }

  setDeleteTarget(null);
  await loadSupply();
}

  return (
    <div className="w-full space-y-8">
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Supply</div>
          <h1 className="sp-title">🚚 Supply Tracker</h1>
        </div>

        <div className="flex gap-3">
  <a
    href={`/api/supply/export?t=${Date.now()}`}
    className="sp-btn sp-btn-ghost"
  >
    📄 Export Excel
  </a>

  <button
    onClick={openCreate}
    className="sp-btn sp-btn-primary"
  >
    + New Supply
  </button>
</div>
      </div>

      {msg && (
        <div className="sp-alert sp-alert-err">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
  <div className="sp-card sp-card-tight">
    <div className="sp-kpi-label">Total</div>
    <div className="sp-kpi-value">{kpis.total}</div>
  </div>

  <div className="sp-card sp-card-tight">
    <div className="sp-kpi-label">Created</div>
    <div className="sp-kpi-value">{kpis.created}</div>
  </div>

  <div className="sp-card sp-card-tight">
    <div className="sp-kpi-label">Shipped</div>
    <div className="sp-kpi-value">{kpis.shipped}</div>
  </div>

  <div className="sp-card sp-card-tight">
    <div className="sp-kpi-label">Received</div>
    <div className="sp-kpi-value">{kpis.received}</div>
  </div>

  <div className="sp-card sp-card-tight">
    <div className="sp-kpi-label">Imported</div>
    <div className="sp-kpi-value">{kpis.imported}</div>
  </div>

  <div className="sp-card sp-card-tight">
  <div className="sp-kpi-label">Failed</div>
  <div className="sp-kpi-value">{kpis.failed}</div>
</div>
</div>

      <div className="sp-card sp-card-tight flex flex-col gap-3 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, tracking, office, item..."
          className="sp-input flex-1"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="sp-select sm:w-auto"
        >
          <option value="ALL">All status</option>
          {STATUS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="sp-card sp-card-flush">
  <div className="overflow-x-auto">
  <table className="sp-table">
    <thead>
  <tr>
    <th onClick={() => sortBy("order_number")} className="py-3 cursor-pointer">
      Order {sortKey === "order_number" ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>

    <th>Created by</th>

    <th onClick={() => sortBy("from_office")} className="cursor-pointer">
      Route {sortKey === "from_office" ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>

    <th>Items</th>
    <th className="text-center">Qty</th>

    <th onClick={() => sortBy("tracking_number")} className="cursor-pointer">
      Tracking {sortKey === "tracking_number" ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>

    <th onClick={() => sortBy("status")} className="cursor-pointer">
      Status {sortKey === "status" ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>

    <th>Imported</th>
    <th>Imported at</th>
    <th className="text-right">Actions</th>
  </tr>
</thead>

    <tbody>
      {paginatedRows.map((row) => (
        <tr key={row.id}>
          <td>
            <button
  onClick={() => openDetails(row)}
  className="sp-btn sp-btn-ghost"
>
  {row.order_number}
</button>
            <div className="text-xs text-sp-muted">
              Created {formatDate(row.created_at)}
            </div>
          </td>

          <td>
  <div className="text-sm text-sp-body">
    {row.created_by || "-"}
  </div>
</td>

          <td>
            <span className="sp-badge sp-badge-neutral">
              {row.from_office} → {row.to_office}
            </span>
          </td>

          <td>
            <div className="space-y-1">
              {(row.supply_items || []).slice(0, 2).map((item: any) => (
                <div key={item.id}>
                  <span className="font-semibold text-sp-text">
                    {item.product_name}
                  </span>
                  <span className="ml-2 text-xs text-sp-muted">
                    {item.qty} pcs
                  </span>
                </div>
              ))}

              {(row.supply_items || []).length > 2 && (
                <div className="text-xs text-sp-muted">
                  +{row.supply_items.length - 2} more
                </div>
              )}
            </div>
          </td>

          <td className="text-center">
            <span className="sp-badge sp-badge-neutral min-w-12 justify-center">
              {totalQty(row)}
            </span>
          </td>

          <td className="max-w-[160px] truncate font-mono">
            {row.tracking_number || "-"}
          </td>

          <td>
            <span
              className={`sp-badge ${statusClass(
                row.status
              )}`}
            >
              {row.status}
            </span>
          </td>

          <td>
            {row.imported ? (
              <span className="sp-badge sp-badge-ok">
                Imported
              </span>
            ) : (
              <span className="sp-badge sp-badge-neutral">
                Not imported
              </span>
            )}
          </td>

          <td className="text-xs text-sp-muted">
  {row.imported_date
    ? formatDate(row.imported_date)
    : "-"}
</td>

          <td className="text-right">
  {!["IMPORTED", "FAILED"].includes(row.status) ? (
    <div className="flex justify-end gap-3">
      <button
        onClick={() => openEdit(row)}
        className="sp-btn sp-btn-ghost"
      >
        Edit
      </button>

      <button
        onClick={() => setDeleteTarget(row)}
        className="sp-btn sp-btn-danger"
      >
        Delete
      </button>
    </div>
  ) : (
    <span className="text-xs text-sp-muted">Locked</span>
  )}
</td>
        </tr>
      ))}

      {paginatedRows.length === 0 && (
        <tr>
          <td colSpan={10} className="py-8 text-center text-sp-muted">
            No supplies found.
          </td>
        </tr>
      )}
    </tbody>
  </table>
  </div>
</div>

<div className="flex items-center justify-between text-sm text-sp-secondary">
  <div>
    Showing {(page - 1) * pageSize + 1}-
    {Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length}
  </div>

  <div className="flex gap-2">
    <button
      onClick={() => setPage((p) => Math.max(1, p - 1))}
      disabled={page === 1}
      className="sp-btn sp-btn-ghost"
    >
      Previous
    </button>

    <div className="px-3 py-2">
      Page {page} / {totalPages}
    </div>

    <button
      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
      disabled={page === totalPages}
      className="sp-btn sp-btn-ghost"
    >
      Next
    </button>
  </div>
</div>
            {openModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="sp-card w-full max-w-3xl p-0">
            <div className="flex justify-between border-b border-sp-border p-5">
              <div>
                <div className="sp-eyebrow">
                  {editing ? "Edit Supply" : "New Supply"}
                </div>
                <div className="text-lg font-semibold">
                  {editing?.order_number || "Create new supply"}
                </div>
              </div>

              <button
                onClick={() => {
                  setOpenModal(false);
                  resetForm();
                }}
                className="sp-btn sp-btn-ghost"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <select
                disabled={!!editing}
                  value={fromOffice}
                  onChange={(e) => setFromOffice(e.target.value)}
                  className="sp-select"
                >
                  {OFFICES.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <select
                  disabled={!!editing}
                  value={toOffice}
                  onChange={(e) => setToOffice(e.target.value)}
                  className="sp-select"
                >
                  {OFFICES.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>

                {editing && status === "SHIPPED" && (
  <input
    value={tracking}
    onChange={(e) => setTracking(e.target.value)}
    placeholder="Tracking number..."
    className="sp-input"
  />
)}

                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(
  e.target.value as "CREATED" | "SHIPPED" | "RECEIVED" | "IMPORTED" | "FAILED"
)
                  }
                  className="sp-select"
                >
                  {availableStatuses(editing?.status || "CREATED").map((s) => (
  <option key={s} value={s}>
    {s}
  </option>
))}
                </select>

{editing && status === "FAILED" && (
  <textarea
    value={failedReason}
    onChange={(e) => setFailedReason(e.target.value)}
    placeholder="Reason for failure..."
    className="sp-textarea min-h-[80px] md:col-span-2"
  />
)}
              </div>

              <textarea
              disabled={!!editing}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comment..."
                className="sp-textarea min-h-[80px]"
              />

              <div className="space-y-3">
                <div className="flex justify-between">
                  <div className="font-semibold">Items</div>

                  {!editing && (
  <button
    onClick={addItem}
    className="sp-btn sp-btn-ghost"
  >
    + Add item
  </button>
)}
                </div>

                {items.map((item, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 md:grid-cols-[140px_1fr_100px_90px] gap-3"
                  >
                    <select
                    disabled={!!editing}
                      value={item.product_type}
                      onChange={(e) =>
                        updateItem(index, {
                          product_type: e.target.value as "DEVICE" | "ACCESSORY",
                        })
                      }
                      className="sp-select"
                    >
                      <option value="DEVICE">Device</option>
                      <option value="ACCESSORY">Accessory</option>
                    </select>

                    <>
  <input
  disabled={!!editing}
    list={`products-${index}`}
    value={item.product_name}
    onChange={(e) =>
      updateItem(index, { product_name: e.target.value })
    }
    placeholder="Search product..."
    className="sp-input"
  />

  <datalist id={`products-${index}`}>
    {productOptions(item.product_type).map((name) => (
      <option key={name} value={name} />
    ))}
  </datalist>
</>

                    <input
                    disabled={!!editing}
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(index, { qty: Number(e.target.value) })
                      }
                      className="sp-input text-right"
                    />

                    <button
                      onClick={() => removeItem(index)}
                      disabled={!!editing || items.length === 1}
                      className="sp-btn sp-btn-ghost"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 border-t border-sp-border pt-4">
                <button
                  onClick={() => {
                    setOpenModal(false);
                    resetForm();
                  }}
                  className="sp-btn sp-btn-ghost"
                >
                  Cancel
                </button>

                <button
                  onClick={() => saveSupply()}
                  disabled={busy}
                  className="sp-btn sp-btn-primary"
                >
                  {busy ? "Saving..." : editing ? "Save changes" : "Create Supply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{detailTarget && (
  <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
    <div className="sp-card w-full max-w-2xl p-0">
      <div className="flex justify-between border-b border-sp-border p-5">
        <div>
          <div className="sp-eyebrow">Supply details</div>
          <div className="text-lg font-semibold text-sp-primary">
            {detailTarget.order_number}
          </div>
        </div>

        <button
          onClick={() => setDetailTarget(null)}
          className="sp-btn sp-btn-ghost"
        >
          Close
        </button>
      </div>

      <div className="p-5 space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="sp-label">Created by</div>
            <div>{detailTarget.created_by || "-"}</div>
          </div>

          <div>
            <div className="sp-label">Created</div>
            <div>{formatDate(detailTarget.created_at)}</div>
          </div>

          <div>
            <div className="sp-label">Route</div>
            <div>{detailTarget.from_office} → {detailTarget.to_office}</div>
          </div>

          <div>
            <div className="sp-label">Tracking</div>
            <div className="font-mono">{detailTarget.tracking_number || "-"}</div>
          </div>

          <div>
            <div className="sp-label">Status</div>
            <span className={`sp-badge ${statusClass(detailTarget.status)}`}>
              {detailTarget.status}
            </span>
          </div>

          <div>
            <div className="sp-label">Imported at</div>
            <div>{detailTarget.imported_date ? formatDate(detailTarget.imported_date) : "-"}</div>
          </div>
          
        {detailTarget.failed_reason && (
  <div className="col-span-2">
    <div className="sp-label">Failure reason</div>
    <div className="sp-alert sp-alert-err mt-1">
      {detailTarget.failed_reason}
    </div>
  </div>
)}

        </div>

        <div>
          <div className="sp-label mb-2">Items</div>

          <div className="overflow-hidden rounded-lg border border-sp-border">
            {(detailTarget.supply_items || []).map((item: any) => (
              <div
                key={item.id}
                className="flex justify-between border-b border-sp-border px-4 py-3 last:border-b-0"
              >
                <div>
                  <div className="font-semibold">{item.product_name}</div>
                  <div className="text-xs text-sp-muted">{item.product_type}</div>
                </div>

                <div className="font-bold">{item.qty} pcs</div>
              </div>
            ))}
          </div>
        </div>

        {detailTarget.comment && (
          <div>
            <div className="sp-label">Comment</div>
            <div className="mt-1 rounded-lg bg-sp-surface-2 p-3 text-sp-body">
              {detailTarget.comment}
            </div>
          </div>
        )}

<div>
  <div className="sp-label mb-2">Status history</div>

 <div className="max-h-[300px] overflow-y-auto rounded-lg border border-sp-border">
    {statusHistory.length === 0 ? (
      <div className="p-4 text-center text-sp-muted">
        No history yet
      </div>
    ) : (
      statusHistory.map((h: any) => (
        <div
          key={h.id}
          className="border-b border-sp-border px-4 py-3 last:border-b-0"
        >
          <div className="flex justify-between items-center">
            <span
              className={`sp-badge ${statusClass(
                h.status
              )}`}
            >
              {h.status}
            </span>

            <span className="text-xs text-sp-muted">
              {formatDate(h.created_at)}
            </span>
          </div>

          <div className="mt-2 text-sm text-sp-body">
            {h.changed_by || "-"}
          </div>

          {h.tracking_number && (
            <div className="mt-1 font-mono text-xs text-sp-primary">
              Tracking: {h.tracking_number}
            </div>
          )}

        {h.failed_reason && (
  <div className="sp-alert sp-alert-err mt-1 text-xs">
    Reason: {h.failed_reason}
  </div>
)}

        </div>
      ))
    )}
  </div>
</div>

      </div>
    </div>
  </div>
)}

      <ConfirmDialog
  open={confirmDone}
  title="Mark supply as imported?"
  message="Are you sure? Once this supply is marked as imported, it will be imported and locked. You will no longer be able to edit or delete it."
  confirmText={busy ? "Saving..." : "Yes, mark as imported"}
  cancelText="Cancel"
  danger
  onConfirm={() => saveSupply(true)}
  onCancel={() => setConfirmDone(false)}
/>

<ConfirmDialog
  open={!!deleteTarget}
  title="Delete supply?"
  message={`Are you sure you want to delete ${
    deleteTarget?.order_number || "this supply"
  }? This action cannot be undone.`}
  confirmText={busy ? "Deleting..." : "Delete"}
  cancelText="Cancel"
  danger
  onConfirm={deleteSupply}
  onCancel={() => setDeleteTarget(null)}
/>
    </div>
  );
}
