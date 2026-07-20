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
          setMessage("This link is invalid or has expired. Please request a new one.");
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
        setMessage("This link is invalid or has expired. Please request a new one.");
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
      setMessage("Your password must contain at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }
    if (!sessionReady) {
      setMessage("The access link is not ready yet. Please try again in a moment.");
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
    <main className="flex min-h-screen items-center justify-center bg-transparent p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="text-xs uppercase tracking-[0.18em] text-indigo-300">
          StockPro
        </div>
        <h1 className="mt-2 text-2xl font-bold">Set Your Password</h1>
        <p className="mt-2 text-sm text-slate-400">
          Choose a secure password, then sign in with your email address.
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <input
            type="password"
            placeholder="Confirm password"
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
              ? "Saving…"
              : sessionReady
                ? "Save Password"
                : "Validating Link…"}
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
