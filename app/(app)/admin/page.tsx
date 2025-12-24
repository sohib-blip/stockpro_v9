"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type UserRow = {
  user_id: string;
  email: string | null;
  created_at: string;
  permissions: {
    can_inbound: boolean;
    can_outbound: boolean;
    can_export: boolean;
    can_admin: boolean;
  };
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [err, setErr] = useState<string>("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setErr("Please sign in first.");
        return;
      }
      const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      const json = await safeJson(res);
      if (!json.ok) {
        setErr(json.error || "Failed to load users.");
        setRows([]);
        return;
      }
      setRows(json.users || []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load users.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updatePerm(user_id: string, key: keyof UserRow["permissions"], value: boolean) {
    const token = await getToken();
    if (!token) return;

    const current = rows.find((r) => r.user_id === user_id);
    if (!current) return;

    const next = { ...current.permissions, [key]: value };

    // optimistic UI
    setRows((prev) => prev.map((r) => (r.user_id === user_id ? { ...r, permissions: next } : r)));

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id, permissions: next }),
    });

    const json = await safeJson(res);
    if (!json.ok) {
      toast({ kind: "error", title: "Update failed", message: json.error || "Could not update permissions." });
      // rollback
      setRows((prev) => prev.map((r) => (r.user_id === user_id ? current : r)));
    } else {
      toast({ kind: "success", title: "Permissions updated" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500">Admin</div>
          <h2 className="text-xl font-semibold">Users & Permissions</h2>
          <p className="text-sm text-slate-400 mt-1">Control access to inbound, outbound, exports and admin tools.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-4 text-sm text-rose-200">{err}</div>
      ) : null}

      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 overflow-auto">
        <table className="w-full text-sm border border-slate-800 rounded-xl overflow-hidden">
          <thead className="bg-slate-950/50">
            <tr>
              <th className="text-left p-2 border-b border-slate-800">Email</th>
              <th className="text-left p-2 border-b border-slate-800">User ID</th>
              <th className="text-center p-2 border-b border-slate-800">Inbound</th>
              <th className="text-center p-2 border-b border-slate-800">Outbound</th>
              <th className="text-center p-2 border-b border-slate-800">Export</th>
              <th className="text-center p-2 border-b border-slate-800">Admin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="hover:bg-slate-950/40">
                <td className="p-2 border-b border-slate-800 font-semibold">{r.email || "—"}</td>
                <td className="p-2 border-b border-slate-800 font-mono text-xs text-slate-300">{r.user_id}</td>
                {([
                  ["can_inbound", "Inbound"],
                  ["can_outbound", "Outbound"],
                  ["can_export", "Export"],
                  ["can_admin", "Admin"],
                ] as const).map(([k]) => (
                  <td key={k} className="p-2 border-b border-slate-800 text-center">
                    <input
                      type="checkbox"
                      checked={r.permissions[k]}
                      onChange={(e) => updatePerm(r.user_id, k, e.target.checked)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && !err ? (
              <tr>
                <td colSpan={6} className="p-3 text-sm text-slate-400">
                  {loading ? "Loading…" : "No users."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
