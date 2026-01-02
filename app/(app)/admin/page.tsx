"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type UserRow = {
  user_id: string;
  email: string | null;
  permissions: {
    can_inbound: boolean;
    can_outbound: boolean;
    can_export: boolean;
    can_admin: boolean;
    can_stock_alerts: boolean;
  };
};

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await safeJson(res);
      if (!json.ok) throw new Error(json.error);

      setRows(json.users || []);
    } catch (e: any) {
      setErr(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updatePerm(
    user_id: string,
    key: keyof UserRow["permissions"],
    value: boolean
  ) {
    const token = await getToken();
    if (!token) return;

    const current = rows.find((r) => r.user_id === user_id);
    if (!current) return;

    const next = { ...current.permissions, [key]: value };
    setRows((prev) =>
      prev.map((r) => (r.user_id === user_id ? { ...r, permissions: next } : r))
    );

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id, permissions: next }),
    });

    const json = await safeJson(res);
    if (!json.ok) {
      toast({ kind: "error", title: "Update failed", message: json.error });
      setRows((prev) =>
        prev.map((r) => (r.user_id === user_id ? current : r))
      );
    } else {
      toast({ kind: "success", title: "Permissions updated" });
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Users & Permissions</h2>

      {err && (
        <div className="border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      <div className="overflow-auto border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-950">
            <tr>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-center">Inbound</th>
              <th className="p-2 text-center">Outbound</th>
              <th className="p-2 text-center">Export</th>
              <th className="p-2 text-center">Stock Alerts</th>
              <th className="p-2 text-center">Admin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-slate-800">
                <td className="p-2">{r.email}</td>
                {([
                  "can_inbound",
                  "can_outbound",
                  "can_export",
                  "can_stock_alerts",
                  "can_admin",
                ] as const).map((k) => (
                  <td key={k} className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={r.permissions[k]}
                      onChange={(e) =>
                        updatePerm(r.user_id, k, e.target.checked)
                      }
                      className="h-4 w-4 accent-emerald-600"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
