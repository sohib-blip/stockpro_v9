"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function updatePassword() {
    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Password updated. You can login now.");
    router.push("/login");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      <div className="bg-slate-900 p-6 rounded-xl w-[350px]">
        <h1 className="text-xl font-bold mb-4">Set new password</h1>

        <input
          type="password"
          placeholder="New password"
          className="w-full p-2 mb-4 rounded bg-slate-800"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={updatePassword}
          className="w-full bg-blue-600 p-2 rounded"
        >
          Update password
        </button>

        <p className="mt-3 text-sm">{msg}</p>
      </div>
    </main>
  );
}