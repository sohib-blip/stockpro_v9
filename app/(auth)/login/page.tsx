"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ConfirmDialog";

function getMessageTone(message: string) {
  if (message.startsWith("📧")) return "sp-alert-info";
  if (message.includes("cancelled")) return "sp-alert-warn";
  return "sp-alert-err";
}

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient();

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

      const localSessionId = window.sessionStorage.getItem("stockpro_session_id");

      if (session?.user && localSessionId) {
        window.location.href = "/dashboard";
        return;
      }

      if (session?.user && !localSessionId) {
        await supabase.auth.signOut();
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

    window.sessionStorage.setItem("stockpro_session_id", sessionId);

    setLoading(false);
    window.location.href = "/dashboard";
  }

  async function signIn() {
    if (!email.trim() || !password) {
      setMsg("❌ Please enter an email and a password");
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

    await supabase.auth.signOut();

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

    setMsg("📧 Password reset email sent");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sp-bg p-6 text-sp-body">
      <ConfirmDialog
        open={showSessionDialog}
        title="🔒 Active session detected"
        message={
          "Another device is already using this account.\n\nTaking over this session will immediately disconnect the other device."
        }
        confirmText="Take over session"
        cancelText="Cancel"
        danger
        onConfirm={takeOverSession}
        onCancel={cancelTakeOver}
      />

      <div className="sp-card sp-card-flush w-full max-w-md">
        <div className="sp-banner-test">
          TEST ENVIRONMENT — DO NOT PROCESS REAL INVENTORY
        </div>

        <div className="p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-sp-text">StockPro</h1>
            <p className="mt-1 text-sm font-medium text-sp-secondary">
              Warehouse operations
            </p>
            <p className="mt-2 text-sm text-sp-muted">
              Sign in to access the dashboard.
            </p>
          </div>

          <div className="mb-4">
            <label htmlFor="email" className="sp-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="sp-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="test@gmail.com"
            />
          </div>

          <div className="mb-5">
            <label htmlFor="password" className="sp-label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="sp-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 6 characters"
            />
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={signIn}
              disabled={loading}
              className="sp-btn sp-btn-primary w-full"
            >
              {loading ? "..." : "Sign in"}
            </button>

            <button
              type="button"
              onClick={resetPassword}
              className="self-center text-xs font-medium text-sp-primary hover:text-sp-primary-hover"
            >
              Forgot password?
            </button>
          </div>

          {msg && (
            <p className={`sp-alert mt-5 ${getMessageTone(msg)}`} role="status">
              {msg}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
