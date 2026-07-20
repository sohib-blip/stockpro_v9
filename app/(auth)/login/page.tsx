"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { STOCKPRO_SESSION_KEY } from "@/lib/session-control";
import { Package } from "lucide-react";

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
    <main className="min-h-screen p-6 flex items-center justify-center bg-transparent text-slate-100">
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

      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-7 shadow-xl shadow-black/10">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-950/40">
            <Package size={21} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">
              StockPro
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          </div>
        </div>

        <p className="text-sm text-slate-400 mb-5">
          Access your inventory management workspace.
        </p>

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
    </main>
  );
}
