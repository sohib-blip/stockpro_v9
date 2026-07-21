"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  STOCKPRO_SESSION_KEY,
  STOCKPRO_SESSION_NOTICE_KEY,
} from "@/lib/session-control";

export default function LoginPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [pendingUserId, setPendingUserId] = useState("");
  const [pendingSessionId, setPendingSessionId] = useState("");

  useEffect(() => {
    const reason =
      new URLSearchParams(window.location.search).get("reason") ||
      window.sessionStorage.getItem(STOCKPRO_SESSION_NOTICE_KEY);
    if (reason === "session-expired") {
      setMsg(
        "Your previous session was closed because this account signed in on another device."
      );
      window.sessionStorage.removeItem(STOCKPRO_SESSION_NOTICE_KEY);
    }

    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const localSessionId = window.sessionStorage.getItem(STOCKPRO_SESSION_KEY);

      if (session?.user && localSessionId) {
        window.location.href = "/dashboard";
        return;
      }

      if (session?.user && !localSessionId) {
        await supabase.auth.signOut({ scope: "local" });
        return;
      }
    };

    check();
  }, [supabase]);
  async function completeLogin(userId: string, sessionId: string) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        current_session_id: sessionId,
        last_seen_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (profileError) {
      setLoading(false);
      setMsg(profileError.message);
      return;
    }

    window.sessionStorage.setItem(STOCKPRO_SESSION_KEY, sessionId);

    setLoading(false);
    window.location.href = "/dashboard";
  }

  async function signIn() {
    if (!email.trim() || !password) {
      setMsg("Please enter an email and a password");
      return;
    }

    setLoading(true);
    setMsg(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoading(false);
      setMsg(error.message);
      return;
    }

    const user = data.user;

    if (!user) {
      setLoading(false);
      setMsg("Login failed");
      return;
    }

    const sessionId = crypto.randomUUID();

    let { data: profile, error: profileReadError } = await supabase
  .from("profiles")
  .select("current_session_id,last_seen_at")
  .eq("user_id", user.id)
  .maybeSingle();

if (profileReadError) {
  setLoading(false);
  setMsg(profileReadError.message);
  return;
}

if (!profile) {
  const { error: insertProfileError } = await supabase.from("profiles").insert({
    user_id: user.id,
    email: user.email,
    current_session_id: null,
    last_seen_at: null,
  });

  if (insertProfileError) {
    setLoading(false);
    setMsg(insertProfileError.message);
    return;
  }

  profile = {
    current_session_id: null,
    last_seen_at: null,
  };
}

    const lastSeen = profile?.last_seen_at
  ? new Date(profile.last_seen_at).getTime()
  : 0;

const isSessionReallyActive =
  profile?.current_session_id &&
  lastSeen &&
  Date.now() - lastSeen < 2 * 60 * 1000;

if (isSessionReallyActive) {
  setPendingUserId(user.id);
  setPendingSessionId(sessionId);
  setShowSessionDialog(true);
  setLoading(false);
  return;
}

    await completeLogin(user.id, sessionId);
  }

  async function takeOverSession() {
    setShowSessionDialog(false);
    setLoading(true);

    await completeLogin(pendingUserId, pendingSessionId);
  }

  async function cancelTakeOver() {
    setShowSessionDialog(false);
    setPendingUserId("");
    setPendingSessionId("");

    await supabase.auth.signOut({ scope: "local" });

    setMsg("Login cancelled. Existing session remains active.");
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMsg("Enter your email first");
      return;
    }

    setLoading(true);
    setMsg(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Password reset email sent");
  }

  return (
    <main className="auth-shell min-h-screen p-6 flex items-center justify-center">
      <ConfirmDialog
        open={showSessionDialog}
        title="Active session detected"
        message={
          "Another device is already using this account.\n\nTaking over this session will immediately disconnect the other device."
        }
        confirmText="Take over session"
        cancelText="Cancel"
        danger
        onConfirm={takeOverSession}
        onCancel={cancelTakeOver}
      />

      <div className="auth-panel w-full max-w-sm">
      <div className="auth-card-environment">Test environment</div>
      <div className="auth-card w-full rounded-xl border border-slate-800 bg-slate-900/70 p-8">
        <div className="mb-6">
          <div className="text-xl font-bold tracking-tight">StockPro</div>
          <div className="mt-0.5 text-xs text-slate-400">Warehouse operations</div>
          <h1 className="sr-only">Sign in</h1>
        </div>

        <label className="text-sm text-slate-300">Email</label>
        <input
          type="email"
          aria-label="Email"
          className="mb-3 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="test@gmail.com"
        />

        <label className="text-sm text-slate-300">Password</label>
        <input
          type="password"
          aria-label="Password"
          className="mb-4 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2 outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="min 6 characters"
        />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={signIn}
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={resetPassword}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Forgot password?
          </button>
        </div>

        {msg && <p className="mt-4 text-sm text-slate-200">{msg}</p>}
      </div>
      </div>
    </main>
  );
}
