"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AdminPage() {

  const supabase = createSupabaseBrowserClient();
  const [email,setEmail] = useState("");

  useEffect(()=>{
    async function loadUser(){
      const {data} = await supabase.auth.getUser();
      setEmail(data?.user?.email || "");
    }

    loadUser();
  },[]);

  if(email !== "souhaib.mahli@radius.com"){
    return <div className="p-6 text-red-400">Access denied</div>;
  }

  return (
    <div className="space-y-6">

      <h1 className="text-xl font-semibold">
        Admin Panel
      </h1>

      <div className="card-glow p-6">
        Only you can access this page
      </div>

    </div>
  );
}