"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {

  const supabase = createSupabaseBrowserClient();
  const [password,setPassword] = useState("");

  async function updatePassword(){

    await supabase.auth.updateUser({
      password
    });

    alert("Password updated");
  }

  return (
    <div className="flex items-center justify-center min-h-screen">

      <div className="card-glow p-8 space-y-4 w-[400px]">

        <h1 className="text-xl font-semibold">
          Create your password
        </h1>

        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
        />

        <button
          onClick={updatePassword}
          className="bg-indigo-600 px-4 py-2 rounded"
        >
          Update password
        </button>

      </div>

    </div>
  );
}