"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AppRole,
  PermissionKey,
  Permissions,
  permissionsForRole,
} from "@/lib/access-control";
import { apiFetch } from "@/lib/apiFetch";

type ManagedUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: AppRole | null;
  permissions: Permissions | null;
};

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  operator: "Operator",
  viewer: "Read-only",
};

const PERMISSION_LABELS: Array<[PermissionKey, string]> = [
  ["can_dashboard", "Dashboard"],
  ["can_inbound", "Inbound Processing"],
  ["can_outbound", "Device Outbound"],
  ["can_returns", "Customer Returns"],
  ["can_transfer", "Stock Transfers"],
  ["can_labels", "Label Printing"],
  ["can_bins", "Inventory Setup"],
  ["can_accessories", "Accessory Outbound"],
  ["can_supply", "Supply Orders"],
  ["can_nrd", "NRD Tracking"],
  ["can_admin", "User Access"],
];

function accessForUser(user: ManagedUser) {
  return {
    role: user.role ?? ("viewer" as AppRole),
    permissions: user.permissions ?? permissionsForRole(user.role ?? "viewer"),
  };
}

export default function AdminPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("viewer");
  const [invitePermissions, setInvitePermissions] = useState<Permissions>(
    permissionsForRole("viewer")
  );
  const [inviting, setInviting] = useState(false);

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.email.localeCompare(b.email)),
    [users]
  );

  async function loadUsers() {
    setLoading(true);
    setMessage(null);
    const response = await apiFetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(body?.error || "Unable to load users");
      setLoading(false);
      return;
    }

    setUsers(body.users ?? []);
    setCurrentUserId(body.current_user_id ?? "");
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function updateLocalAccess(
    userId: string,
    updater: (current: { role: AppRole; permissions: Permissions }) => {
      role: AppRole;
      permissions: Permissions;
    }
  ) {
    setUsers((current) =>
      current.map((user) => {
        if (user.id !== userId) return user;
        const next = updater(accessForUser(user));
        return { ...user, ...next };
      })
    );
  }

  async function saveUser(user: ManagedUser) {
    const access = accessForUser(user);
    setSavingId(user.id);
    setMessage(null);
    const response = await apiFetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        role: access.role,
        permissions: access.permissions,
      }),
    });
    const body = await response.json().catch(() => null);
    setSavingId(null);

    if (!response.ok) {
      setMessage(body?.error || "Unable to save permissions");
      await loadUsers();
      return;
    }

    await loadUsers();
    setMessage(`Permissions saved for ${user.email}`);
  }

  async function inviteUser() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    const response = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteEmail,
        role: inviteRole,
        permissions: invitePermissions,
      }),
    });
    const body = await response.json().catch(() => null);
    setInviting(false);

    if (!response.ok) {
      setMessage(body?.error || "Unable to send invitation");
      return;
    }

    setInviteEmail("");
    setInviteRole("viewer");
    setInvitePermissions(permissionsForRole("viewer"));
    await loadUsers();
    setMessage("Invitation sent and access configured");
  }

  return (
    <div className="prototype-page prototype-module-page admin-prototype-page">
      <div className="prototype-page-header">
        <div>
        <h1>User Access</h1>
        <p>
          Invite colleagues and manage roles and module permissions.
        </p>
        </div>
      </div>

      <section className="prototype-card admin-invite-card">
        <h2>Invite a colleague</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="colleague@company.com"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <select
            value={inviteRole}
            onChange={(event) => {
              const role = event.target.value as AppRole;
              setInviteRole(role);
              setInvitePermissions(permissionsForRole(role));
            }}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
          >
            {Object.entries(ROLE_LABELS).map(([role, label]) => (
              <option key={role} value={role}>{label}</option>
            ))}
          </select>
          <button
            onClick={inviteUser}
            disabled={inviting || !inviteEmail.trim()}
            className="prototype-button primary"
          >
            {inviting ? "Sending…" : "Send Invitation"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {PERMISSION_LABELS.map(([permission, label]) => (
            <label key={permission} className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={inviteRole === "admin" || invitePermissions[permission]}
                disabled={inviteRole === "admin" || permission === "can_admin"}
                onChange={(event) =>
                  setInvitePermissions((current) => ({
                    ...current,
                    [permission]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {message && (
        <div className="rounded-xl border border-cyan-700/60 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-100">
          {message}
        </div>
      )}

      <section className="prototype-card admin-users-card">
        <div className="admin-users-heading">
          <h2 className="font-semibold">Users ({users.length})</h2>
          <button onClick={loadUsers} className="text-sm text-indigo-300 hover:text-indigo-200">
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : (
          sortedUsers.map((user) => {
            const access = accessForUser(user);
            return (
              <article key={user.id} className="admin-user-row">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {user.email || "User without an email address"}
                      {user.id === currentUserId && (
                        <span className="ml-2 rounded-full bg-indigo-500/20 px-2 py-1 text-[10px] uppercase text-indigo-200">
                          Current user
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Last sign-in: {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("en-GB") : "Never"}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={access.role}
                      onChange={(event) => {
                        const role = event.target.value as AppRole;
                        updateLocalAccess(user.id, () => ({
                          role,
                          permissions: permissionsForRole(role),
                        }));
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    >
                      {Object.entries(ROLE_LABELS).map(([role, label]) => (
                        <option key={role} value={role}>{label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => saveUser(user)}
                      disabled={savingId === user.id}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {savingId === user.id ? "Saving…" : "Save Changes"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {PERMISSION_LABELS.map(([permission, label]) => (
                    <label key={permission} className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={access.role === "admin" || access.permissions[permission]}
                        disabled={access.role === "admin" || permission === "can_admin"}
                        onChange={(event) =>
                          updateLocalAccess(user.id, (current) => ({
                            role: current.role,
                            permissions: {
                              ...current.permissions,
                              [permission]: event.target.checked,
                            },
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </article>
            );
          })
        )}

        {!loading && users.length === 0 && (
          <div className="rounded-xl border border-slate-800 p-5 text-sm text-slate-400">
            No users found.
          </div>
        )}
      </section>
    </div>
  );
}
