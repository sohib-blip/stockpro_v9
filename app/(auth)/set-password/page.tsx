"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseAuthCallbackSession } from "@/lib/auth-callback";
import { useEffect, useMemo, useState } from "react";

export default function SetPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function prepareSession() {
      const callbackSession = parseAuthCallbackSession(window.location.hash);

      if (callbackSession) {
        const { error } = await supabase.auth.setSession(callbackSession);
        if (!active) return;

        if (error) {
          setMessage("Ce lien est invalide ou a expiré. Demandez une nouvelle invitation.");
          return;
        }

        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`
        );
        setSessionReady(true);
        return;
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (!active) return;

      if (error || !session) {
        setMessage("Ce lien est invalide ou a expiré. Demandez une nouvelle invitation.");
        return;
      }

      setSessionReady(true);
    }

    void prepareSession();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function updatePassword() {
    setMessage("");
    if (password.length < 8) {
      setMessage("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!sessionReady) {
      setMessage("Le lien d'invitation n'est pas encore prêt. Réessayez dans un instant.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/login";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-indigo-300">
          StockPro
        </div>
        <h1 className="mt-2 text-2xl font-bold">Créer votre mot de passe</h1>
        <p className="mt-2 text-sm text-slate-400">
          Choisissez votre mot de passe, puis connectez-vous avec votre email.
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="password"
            placeholder="Nouveau mot de passe"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <input
            type="password"
            placeholder="Confirmer le mot de passe"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <button
            onClick={updatePassword}
            disabled={loading || !sessionReady}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2 font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading
              ? "Enregistrement…"
              : sessionReady
                ? "Enregistrer le mot de passe"
                : "Validation du lien…"}
          </button>
        </div>

        {message && (
          <div className="mt-4 rounded-xl border border-rose-800 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}
