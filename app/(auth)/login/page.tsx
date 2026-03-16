"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
  const check = async () => {
    const { data: { session } } = await supabase.auth.getSession()

    if (session?.user) {
      window.location.href = "/dashboard"
    }
  }

  check()
}, [])

  async function signIn() {
    // ✅ block empty submit (prevents anonymous attempt)
    if (!email.trim() || !password) {
      setMsg("❌ Please enter an email and a password");
      return;
    }

    setLoading(true);
    setMsg(null);

    console.log("SIGNIN DATA:", email.trim(), password ? "***" : "");

    const { data, error } = await supabase.auth.signInWithPassword({
  email: email.trim(),
  password,
});

console.log("LOGIN RESULT", data, error);

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    window.location.href = "/dashboard";
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
    <main className="min-h-screen p-6 flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 shadow-sm p-6">
        <h1 className="text-2xl font-bold mb-2">🔐 Login</h1>
        <p className="text-sm text-slate-400 mb-5">Sign in to access the dashboard.</p>

        <label className="text-sm text-slate-300">Email</label>
        <input
          type="email"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2 mb-3 outline-none focus:ring-2 focus:ring-slate-700"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="test@gmail.com"
        />

        <label className="text-sm text-slate-300">Password</label>
        <input
          type="password"
          className="w-full rounded-lg border border-slate-800 bg-slate-950/60 p-2 mb-4 outline-none focus:ring-2 focus:ring-slate-700"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="min 6 characters"
        />

        <div className="flex flex-col gap-2">

  <button
  type="button"
  onClick={signIn}
  disabled={loading}
  className="w-full rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 px-4 py-2 font-semibold disabled:opacity-50"
>
    {loading ? "..." : "Sign in"}
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
