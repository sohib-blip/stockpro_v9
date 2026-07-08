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

const STATUS = ["CREATED", "PENDING", "DONE"] as const;

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
  const [status, setStatus] = useState<"CREATED" | "PENDING" | "DONE">("CREATED");
  const [comment, setComment] = useState("");

  const [items, setItems] = useState<SupplyItem[]>([
    { product_type: "DEVICE", product_name: "", qty: 1 },
  ]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [detailTarget, setDetailTarget] = useState<any | null>(null);

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
    setStatus("CREATED");
    setComment("");
    setItems([{ product_type: "DEVICE", product_name: "", qty: 1 }]);
  }

  function openCreate() {
    resetForm();
    setOpenModal(true);
  }

  function openEdit(row: any) {
    setEditing(row);
    setFromOffice(row.from_office || "UK");
    setToOffice(row.to_office || "BE");
    setTracking(row.tracking_number || "");
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
  if (editing && status === "DONE" && editing.status !== "DONE" && !forceDone) {
    setConfirmDone(true);
    return;
  }

  setBusy(true);
  setMsg("");

  const payload = editing
    ? {
        id: editing.id,
        status,
      }
    : {
        from_office: fromOffice,
        to_office: toOffice,
        tracking_number: tracking,
        status,
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

if (editing && json.row) {
  setRows((prev) =>
    prev.map((row) =>
      row.id === json.row.id
        ? {
            ...row,
            status: json.row.status,
            imported: json.row.imported,
            imported_date: json.row.imported_date,
            updated_at: json.row.updated_at,
          }
        : row
    )
  );
} else {
  await loadSupply();
}

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
    pending: rows.filter((r) => r.status === "PENDING").length,
    done: rows.filter((r) => r.status === "DONE").length,
    imported: rows.filter((r) => r.imported).length,
  };

    function statusClass(status: string) {
    if (status === "DONE") return "bg-green-500/20 text-green-400";
    if (status === "PENDING") return "bg-yellow-500/20 text-yellow-400";
    return "bg-blue-500/20 text-blue-400";
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
    <div className="space-y-8 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">Supply</div>
          <h1 className="text-2xl font-semibold">🚚 Supply Tracker</h1>
        </div>

        <div className="flex gap-3">
  <a
    href={`/api/supply/export?t=${Date.now()}`}
    className="rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold"
  >
    📄 Export Excel
  </a>

  <button
    onClick={openCreate}
    className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
  >
    + New Supply
  </button>
</div>
      </div>

      {msg && (
        <div className="rounded-xl border border-red-500 bg-red-500/20 px-4 py-3 text-sm text-red-300">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card-glow p-4 rounded-xl">
          <div className="text-xs text-slate-400">Total</div>
          <div className="text-2xl font-bold text-cyan-400">{kpis.total}</div>
        </div>

        <div className="card-glow p-4 rounded-xl">
          <div className="text-xs text-slate-400">Created</div>
          <div className="text-2xl font-bold text-blue-400">{kpis.created}</div>
        </div>

        <div className="card-glow p-4 rounded-xl">
          <div className="text-xs text-slate-400">Pending</div>
          <div className="text-2xl font-bold text-yellow-400">{kpis.pending}</div>
        </div>

        <div className="card-glow p-4 rounded-xl">
          <div className="text-xs text-slate-400">Done</div>
          <div className="text-2xl font-bold text-green-400">{kpis.done}</div>
        </div>

        <div className="card-glow p-4 rounded-xl">
          <div className="text-xs text-slate-400">Imported</div>
          <div className="text-2xl font-bold text-purple-400">{kpis.imported}</div>
        </div>
      </div>

      <div className="card-glow p-4 rounded-xl flex gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, tracking, office, item..."
          className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="ALL">All status</option>
          {STATUS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="card-glow p-6 rounded-xl overflow-hidden">
  <table className="w-full text-sm">
    <thead>
  <tr className="text-left text-slate-400 border-b border-slate-800">
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
        <tr key={row.id} className="border-b border-slate-800/70">
          <td className="py-4">
            <button
  onClick={() => setDetailTarget(row)}
  className="font-semibold text-cyan-400 hover:text-cyan-300 hover:underline"
>
  {row.order_number}
</button>
            <div className="text-xs text-slate-500">
              Created {formatDate(row.created_at)}
            </div>
          </td>

          <td>
  <div className="text-sm text-slate-200">
    {row.created_by || "-"}
  </div>
</td>

          <td>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">
              {row.from_office} → {row.to_office}
            </span>
          </td>

          <td>
            <div className="space-y-1">
              {(row.supply_items || []).slice(0, 2).map((item: any) => (
                <div key={item.id}>
                  <span className="font-semibold text-slate-100">
                    {item.product_name}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {item.qty} pcs
                  </span>
                </div>
              ))}

              {(row.supply_items || []).length > 2 && (
                <div className="text-xs text-slate-500">
                  +{row.supply_items.length - 2} more
                </div>
              )}
            </div>
          </td>

          <td className="text-center">
            <span className="inline-flex min-w-12 justify-center rounded-xl bg-slate-800 px-3 py-1 font-bold text-slate-100">
              {totalQty(row)}
            </span>
          </td>

          <td className="font-mono text-slate-300 max-w-[160px] truncate">
            {row.tracking_number || "-"}
          </td>

          <td>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClass(
                row.status
              )}`}
            >
              {row.status}
            </span>
          </td>

          <td>
            {row.imported ? (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-500/20 text-green-400">
                Imported
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-500/20 text-slate-400">
                Not imported
              </span>
            )}
          </td>

          <td className="text-xs text-slate-400">
  {row.imported_date
    ? formatDate(row.imported_date)
    : "-"}
</td>

          <td className="text-right">
  {row.status !== "DONE" ? (
    <div className="flex justify-end gap-3">
      <button
        onClick={() => openEdit(row)}
        className="text-cyan-400 hover:text-cyan-300 font-semibold"
      >
        Edit
      </button>

      <button
        onClick={() => setDeleteTarget(row)}
        className="text-red-400 hover:text-red-300 font-semibold"
      >
        Delete
      </button>
    </div>
  ) : (
    <span className="text-xs text-slate-500">Locked</span>
  )}
</td>
        </tr>
      ))}

      {paginatedRows.length === 0 && (
        <tr>
          <td colSpan={10} className="py-8 text-center text-slate-500">
            No supplies found.
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>

<div className="flex items-center justify-between text-sm text-slate-400">
  <div>
    Showing {(page - 1) * pageSize + 1}-
    {Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length}
  </div>

  <div className="flex gap-2">
    <button
      onClick={() => setPage((p) => Math.max(1, p - 1))}
      disabled={page === 1}
      className="rounded-xl border border-slate-800 px-3 py-2 disabled:opacity-40"
    >
      Previous
    </button>

    <div className="px-3 py-2">
      Page {page} / {totalPages}
    </div>

    <button
      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
      disabled={page === totalPages}
      className="rounded-xl border border-slate-800 px-3 py-2 disabled:opacity-40"
    >
      Next
    </button>
  </div>
</div>
            {openModal && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
            <div className="p-5 border-b border-slate-800 flex justify-between">
              <div>
                <div className="text-xs text-slate-500">
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
                className="text-slate-400 hover:text-slate-200"
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
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
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
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                >
                  {OFFICES.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <input
                disabled={!!editing}
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  placeholder="Tracking number..."
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                />

                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "CREATED" | "PENDING" | "DONE")
                  }
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                >
                  {STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
              disabled={!!editing}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Comment..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm min-h-[80px]"
              />

              <div className="space-y-3">
                <div className="flex justify-between">
                  <div className="font-semibold">Items</div>

                  {!editing && (
  <button
    onClick={addItem}
    className="rounded-xl border border-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-800"
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
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
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
    className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
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
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-right"
                    />

                    <button
                      onClick={() => removeItem(index)}
                      disabled={!!editing || items.length === 1}
                      className="rounded-xl border border-slate-800 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  onClick={() => {
                    setOpenModal(false);
                    resetForm();
                  }}
                  className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
                >
                  Cancel
                </button>

                <button
                  onClick={() => saveSupply()}
                  disabled={busy}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                >
                  {busy ? "Saving..." : editing ? "Save changes" : "Create Supply"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

{detailTarget && (
  <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4">
    <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950 shadow-xl">
      <div className="p-5 border-b border-slate-800 flex justify-between">
        <div>
          <div className="text-xs text-slate-500">Supply details</div>
          <div className="text-lg font-semibold text-cyan-400">
            {detailTarget.order_number}
          </div>
        </div>

        <button
          onClick={() => setDetailTarget(null)}
          className="text-slate-400 hover:text-slate-200"
        >
          Close
        </button>
      </div>

      <div className="p-5 space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-500">Created by</div>
            <div>{detailTarget.created_by || "-"}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Created</div>
            <div>{formatDate(detailTarget.created_at)}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Route</div>
            <div>{detailTarget.from_office} → {detailTarget.to_office}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Tracking</div>
            <div className="font-mono">{detailTarget.tracking_number || "-"}</div>
          </div>

          <div>
            <div className="text-xs text-slate-500">Status</div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClass(detailTarget.status)}`}>
              {detailTarget.status}
            </span>
          </div>

          <div>
            <div className="text-xs text-slate-500">Imported at</div>
            <div>{detailTarget.imported_date ? formatDate(detailTarget.imported_date) : "-"}</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-2">Items</div>

          <div className="rounded-xl border border-slate-800 overflow-hidden">
            {(detailTarget.supply_items || []).map((item: any) => (
              <div
                key={item.id}
                className="flex justify-between px-4 py-3 border-b border-slate-800 last:border-b-0"
              >
                <div>
                  <div className="font-semibold">{item.product_name}</div>
                  <div className="text-xs text-slate-500">{item.product_type}</div>
                </div>

                <div className="font-bold">{item.qty} pcs</div>
              </div>
            ))}
          </div>
        </div>

        {detailTarget.comment && (
          <div>
            <div className="text-xs text-slate-500">Comment</div>
            <div className="rounded-xl bg-slate-900 p-3 mt-1">
              {detailTarget.comment}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)}

      <ConfirmDialog
  open={confirmDone}
  title="Mark supply as done?"
  message="Are you sure? Once this supply is marked as DONE, it will be imported and locked. You will no longer be able to edit or delete it."
  confirmText={busy ? "Saving..." : "Yes, mark as done"}
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