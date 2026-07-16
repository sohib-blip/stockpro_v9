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
  admin: "Administrateur",
  operator: "Opérateur",
  viewer: "Lecture seule",
};

const PERMISSION_LABELS: Array<[PermissionKey, string]> = [
  ["can_dashboard", "Dashboard"],
  ["can_inbound", "Inbound"],
  ["can_outbound", "Outbound"],
  ["can_returns", "Returns"],
  ["can_transfer", "Transfer"],
  ["can_labels", "Labels"],
  ["can_bins", "Bins"],
  ["can_accessories", "Accessories"],
  ["can_supply", "Supply"],
  ["can_nrd", "NRD"],
  ["can_admin", "Administration"],
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
      setMessage(body?.error || "Impossible de charger les utilisateurs");
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
      setMessage(body?.error || "Impossible d’enregistrer les droits");
      await loadUsers();
      return;
    }

    setMessage(`Droits enregistrés pour ${user.email}`);
    await loadUsers();
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
      setMessage(body?.error || "Invitation impossible");
      return;
    }

    setInviteEmail("");
    setInviteRole("viewer");
    setInvitePermissions(permissionsForRole("viewer"));
    setMessage("Invitation envoyée et accès préparés");
    await loadUsers();
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-indigo-300">
          Sécurité
        </div>
        <h1 className="text-2xl font-bold">Administration des accès</h1>
        <p className="mt-1 text-sm text-slate-400">
          Gérez les rôles et les modules autorisés pour chaque collègue.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="font-semibold">Inviter un collègue</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="collegue@entreprise.com"
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
            className="rounded-xl bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {inviting ? "Envoi…" : "Envoyer l’invitation"}
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

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Utilisateurs ({users.length})</h2>
          <button onClick={loadUsers} className="text-sm text-indigo-300 hover:text-indigo-200">
            Actualiser
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-400">Chargement…</div>
        ) : (
          sortedUsers.map((user) => {
            const access = accessForUser(user);
            return (
              <article key={user.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {user.email || "Utilisateur sans email"}
                      {user.id === currentUserId && (
                        <span className="ml-2 rounded-full bg-indigo-500/20 px-2 py-1 text-[10px] uppercase text-indigo-200">
                          Vous
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Dernière connexion : {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString("fr-BE") : "jamais"}
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
                      {savingId === user.id ? "…" : "Enregistrer"}
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
            Aucun utilisateur trouvé.
          </div>
        )}
      </section>
    </div>
  );
}
