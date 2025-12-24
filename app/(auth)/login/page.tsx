"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function signIn() {
    // ✅ block empty submit (prevents anonymous attempt)
    if (!email.trim() || !password) {
      setMsg("❌ Please enter an email and a password");
      return;
    }

    setLoading(true);
    setMsg(null);

    console.log("SIGNIN DATA:", email.trim(), password ? "***" : "");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.push("/dashboard");
  }

  async function signUp() {
    // ✅ block empty submit (prevents anonymous attempt)
    if (!email.trim() || !password) {
      setMsg("❌ Please enter an email and a password");
      return;
    }

    setLoading(true);
    setMsg(null);

    console.log("SIGNUP DATA:", email.trim(), password ? "***" : "");

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("✅ Account created. You can sign in now.");
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

        <div className="flex gap-2">
          <button
            onClick={signIn}
            disabled={loading}
            className="flex-1 rounded-lg bg-slate-800 text-slate-100 hover:bg-slate-700 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {loading ? "..." : "Sign in"}
          </button>

          <button
            onClick={signUp}
            disabled={loading}
            className="flex-1 rounded-lg bg-slate-800 text-slate-100 px-4 py-2 font-semibold border border-slate-700 disabled:opacity-50"
          >
            {loading ? "..." : "Sign up"}
          </button>
        </div>

        {msg && <p className="mt-4 text-sm text-slate-200">{msg}</p>}

        <p className="mt-4 text-xs text-slate-400">
          If signup works but login fails: in Supabase → Auth → Providers → Email,
          disable email confirmation for local dev.
        </p>
      </div>
    </main>
  );
}
