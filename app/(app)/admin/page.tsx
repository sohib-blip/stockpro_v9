"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Role = "admin" | "operator" | "viewer";
type Permissions = {
  can_dashboard: boolean;
  can_inbound: boolean;
  can_outbound: boolean;
  can_labels: boolean;
  can_devices: boolean;
  can_admin: boolean;
};
type PermissionKey = keyof Permissions;

type AdminUser = {
  id: string;
  email: string;
  last_sign_in_at: string | null;
  role: Role;
  permissions: Permissions;
};

type UsersResponse = {
  ok: true;
  users: AdminUser[];
  currentUserId: string;
};

type Message = {
  kind: "ok" | "err";
  text: string;
};

const ROLE_PRESETS: Record<Role, Permissions> = {
  admin: {
    can_dashboard: true,
    can_inbound: true,
    can_outbound: true,
    can_labels: true,
    can_devices: true,
    can_admin: true,
  },
  operator: {
    can_dashboard: true,
    can_inbound: true,
    can_outbound: true,
    can_labels: true,
    can_devices: true,
    can_admin: false,
  },
  viewer: {
    can_dashboard: true,
    can_inbound: false,
    can_outbound: false,
    can_labels: false,
    can_devices: false,
    can_admin: false,
  },
};

const PERMISSION_OPTIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: "can_dashboard", label: "Dashboard" },
  { key: "can_inbound", label: "Inbound" },
  { key: "can_outbound", label: "Outbound" },
  { key: "can_labels", label: "Labels" },
  { key: "can_devices", label: "Devices" },
  { key: "can_admin", label: "Admin" },
];

function formatLastSignIn(value: string | null) {
  if (!value) return "Never";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";

  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

function PermissionCheckboxes({
  permissions,
  role,
  onChange,
  disabled = false,
}: {
  permissions: Permissions;
  role: Role;
  onChange: (key: PermissionKey, checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-3">
      {PERMISSION_OPTIONS.map(({ key, label }) => {
        const adminPermissionIsForced = role === "admin" && key === "can_admin";

        return (
          <label
            key={key}
            className="inline-flex items-center gap-2 text-[12.5px] text-sp-body"
          >
            <input
              type="checkbox"
              checked={adminPermissionIsForced ? true : permissions[key]}
              disabled={disabled || adminPermissionIsForced}
              onChange={(event) => onChange(key, event.target.checked)}
              className="h-4 w-4 rounded border-sp-border-strong accent-sp-primary disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function AdminPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingUserIds, setSavingUserIds] = useState<Set<string>>(() => new Set());
  const [usersMessage, setUsersMessage] = useState<Message | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("operator");
  const [invitePermissions, setInvitePermissions] = useState<Permissions>({
    ...ROLE_PRESETS.operator,
  });
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<Message | null>(null);

  const apiRequest = useCallback(
    async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);

      const token = data.session?.access_token;
      if (!token) throw new Error("Your session has expired. Sign in again.");

      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const response = await fetch(url, { ...init, headers, cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | ({ ok?: boolean; error?: string } & T)
        | null;

      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload?.error || "The request could not be completed.");
      }

      return payload;
    },
    [supabase]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const response = await apiRequest<UsersResponse>("/api/admin/users");
      setUsers(response.users);
      setCurrentUserId(response.currentUserId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  function changeInviteRole(role: Role) {
    setInviteRole(role);
    setInvitePermissions({ ...ROLE_PRESETS[role] });
  }

  function changeInvitePermission(key: PermissionKey, checked: boolean) {
    setInvitePermissions((current) => ({
      ...current,
      [key]: inviteRole === "admin" && key === "can_admin" ? true : checked,
    }));
  }

  async function sendInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setInviteMessage(null);

    try {
      await apiRequest<{ ok: true }>("/api/admin/invite", {
        method: "POST",
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
          permissions: invitePermissions,
        }),
      });
      setInviteEmail("");
      setInviteMessage({ kind: "ok", text: "Invitation sent." });
      await loadUsers();
    } catch (error) {
      setInviteMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Unable to send invitation.",
      });
    } finally {
      setInviting(false);
    }
  }

  function changeUserRole(userId: string, role: Role) {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? { ...user, role, permissions: { ...ROLE_PRESETS[role] } }
          : user
      )
    );
    setUsersMessage(null);
  }

  function changeUserPermission(userId: string, key: PermissionKey, checked: boolean) {
    setUsers((current) =>
      current.map((user) => {
        if (user.id !== userId) return user;

        return {
          ...user,
          permissions: {
            ...user.permissions,
            [key]: user.role === "admin" && key === "can_admin" ? true : checked,
          },
        };
      })
    );
    setUsersMessage(null);
  }

  async function saveUser(user: AdminUser) {
    setSavingUserIds((current) => {
      const next = new Set(current);
      next.add(user.id);
      return next;
    });
    setUsersMessage(null);

    try {
      await apiRequest<{ ok: true }>("/api/admin/update", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          role: user.role,
          permissions: user.permissions,
        }),
      });
      setUsersMessage({ kind: "ok", text: `Access saved for ${user.email || "this user"}.` });
    } catch (error) {
      setUsersMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Unable to save user access.",
      });
    } finally {
      setSavingUserIds((current) => {
        const next = new Set(current);
        next.delete(user.id);
        return next;
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="sp-page-header">
        <div>
          <div className="sp-eyebrow">Administration</div>
          <h1 className="sp-title">User Access</h1>
          <p className="sp-desc">
            Invite team members and manage the roles and permissions available to each user.
          </p>
        </div>
        <button
          type="button"
          className="sp-btn sp-btn-ghost"
          onClick={() => void loadUsers()}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <section className="sp-card" aria-labelledby="invite-user-heading">
        <h2 id="invite-user-heading" className="text-base font-semibold text-sp-text">
          Invite User
        </h2>
        <p className="sp-desc">Send an invitation and choose the user&apos;s starting access.</p>

        <form className="mt-5" onSubmit={sendInvitation}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
            <div>
              <label className="sp-label" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                className="sp-input"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@company.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="sp-label" htmlFor="invite-role">
                Role
              </label>
              <select
                id="invite-role"
                className="sp-select"
                value={inviteRole}
                onChange={(event) => changeInviteRole(event.target.value as Role)}
              >
                <option value="admin">Administrator</option>
                <option value="operator">Operator</option>
                <option value="viewer">Read-only</option>
              </select>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="sp-label">Permissions</legend>
            <PermissionCheckboxes
              permissions={invitePermissions}
              role={inviteRole}
              onChange={changeInvitePermission}
            />
          </fieldset>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" className="sp-btn sp-btn-primary" disabled={inviting}>
              {inviting ? "Sending invitation..." : "Send invitation"}
            </button>
            {inviteMessage && (
              <div
                className={`sp-alert ${
                  inviteMessage.kind === "ok" ? "sp-alert-ok" : "sp-alert-err"
                }`}
                role={inviteMessage.kind === "err" ? "alert" : "status"}
                aria-live="polite"
              >
                {inviteMessage.text}
              </div>
            )}
          </div>
        </form>
      </section>

      <section aria-labelledby="users-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="users-heading" className="text-base font-semibold text-sp-text">
              Users
            </h2>
            <p className="sp-desc">Adjust a role or individual permission, then save the row.</p>
          </div>
        </div>

        {usersMessage && (
          <div
            className={`sp-alert mb-3 ${
              usersMessage.kind === "ok" ? "sp-alert-ok" : "sp-alert-err"
            }`}
            role={usersMessage.kind === "err" ? "alert" : "status"}
            aria-live="polite"
          >
            {usersMessage.text}
          </div>
        )}

        {loading ? (
          <div className="sp-card">
            <p className="sp-desc">Loading users...</p>
          </div>
        ) : loadError ? (
          <div className="sp-alert sp-alert-err" role="alert">
            {loadError}
          </div>
        ) : (
          <div className="sp-card sp-card-flush">
            <div className="overflow-x-auto">
              <table className="sp-table min-w-[1120px]">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Last sign-in</th>
                    <th>Role</th>
                    <th>Permissions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-sp-muted">
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sp-text">
                              {user.email || "No email"}
                            </span>
                            {user.id === currentUserId && (
                              <span className="sp-badge sp-badge-brand">You</span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {formatLastSignIn(user.last_sign_in_at)}
                        </td>
                        <td>
                          <select
                            className="sp-select w-36 py-1.5"
                            value={user.role}
                            disabled={savingUserIds.has(user.id)}
                            aria-label={`Role for ${user.email || "user"}`}
                            onChange={(event) =>
                              changeUserRole(user.id, event.target.value as Role)
                            }
                          >
                            <option value="admin">Administrator</option>
                            <option value="operator">Operator</option>
                            <option value="viewer">Read-only</option>
                          </select>
                        </td>
                        <td>
                          <PermissionCheckboxes
                            permissions={user.permissions}
                            role={user.role}
                            disabled={savingUserIds.has(user.id)}
                            onChange={(key, checked) =>
                              changeUserPermission(user.id, key, checked)
                            }
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="sp-btn sp-btn-primary"
                            disabled={savingUserIds.has(user.id)}
                            onClick={() => void saveUser(user)}
                          >
                            {savingUserIds.has(user.id) ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
