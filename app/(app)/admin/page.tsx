"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [rows, setRows] = useState<any[]>([]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token;
  }

  async function load() {
    const token = await getToken();
    const res = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (json.ok) setRows(json.users);
  }

  useEffect(() => {
    load();
  }, []);

  async function update(user_id: string, key: string, value: boolean) {
    const token = await getToken();

    const current = rows.find((r) => r.user_id === user_id);
    const next = { ...current.permissions, [key]: value };

    setRows((prev) =>
      prev.map((r) =>
        r.user_id === user_id ? { ...r, permissions: next } : r
      )
    );

    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id, permissions: next }),
    });
  }

  const keys = [
    "can_dashboard",
    "can_inbound",
    "can_outbound",
    "can_labels",
    "can_devices",
    "can_admin",
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Control Tower</h2>

      <div className="overflow-auto border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left">Email</th>
              {keys.map((k) => (
                <th key={k} className="p-2 text-center">
                  {k.replace("can_", "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t border-slate-800">
                <td className="p-2">{r.email}</td>
                {keys.map((k) => (
                  <td key={k} className="p-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.permissions[k]}
                      onChange={(e) =>
                        update(r.user_id, k, e.target.checked)
                      }
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