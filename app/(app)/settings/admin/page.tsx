"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type UserRole = {
  user_id: string;
  role: string;
  email: string;
};

export default function AdminPage() {

  const supabase = createSupabaseBrowserClient();

  const [users,setUsers] = useState<UserRole[]>([]);
  const [email,setEmail] = useState("");
const [role,setRole] = useState("viewer");
  const [loading,setLoading] = useState(true);

  async function createUser(){

  const res = await fetch("/api/admin/create-user",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({
      email,
      role
    })
  });

  if(res.ok){
    alert("User created");
    setEmail("");
    loadUsers();
  }

}

async function loadUsers(){

    const { data, error } = await supabase
  .from("user_roles")
  .select(`
    user_id,
    role,
    users:auth.users(email)
  `)
  .order("created_at");

    if(!error && data){
      setUsers(
  data.map((u:any)=>({
    user_id: u.user_id,
    role: u.role,
    email: u.users?.email || "unknown"
  }))
);
    }

    setLoading(false);
  }

  useEffect(()=>{
    loadUsers();
  },[]);

  async function changeRole(user_id:string,role:string){

    await supabase
      .from("user_roles")
      .update({role})
      .eq("user_id",user_id);

    loadUsers();
  }

  async function removeUser(user_id:string){

    if(!confirm("Remove this user access ?")) return;

    await supabase
      .from("user_roles")
      .delete()
      .eq("user_id",user_id);

    loadUsers();
  }

  if(loading){
    return <div className="p-6">Loading users...</div>
  }

  return (
    <div className="space-y-6 max-w-4xl">

      <h1 className="text-xl font-semibold">
        Admin • User Management
      </h1>

      <div className="card-glow p-6 space-y-3">

  <h2 className="font-semibold">
    Create User
  </h2>

  <input
    placeholder="email"
    value={email}
    onChange={(e)=>setEmail(e.target.value)}
    className="border bg-slate-900 p-2 rounded w-full"
  />

  <select
    value={role}
    onChange={(e)=>setRole(e.target.value)}
    className="border bg-slate-900 p-2 rounded w-full"
  >
    <option value="admin">admin</option>
    <option value="warehouse">warehouse</option>
    <option value="viewer">viewer</option>
  </select>

  <button
    onClick={createUser}
    className="bg-indigo-600 px-4 py-2 rounded"
  >
    Create user
  </button>

</div>

      <div className="card-glow p-6">

        <table className="w-full text-sm">

          <thead className="text-slate-400 border-b border-slate-800">
            <tr>
              <th className="text-left py-2">Email</th>
              <th className="text-left">Role</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>

          <tbody>

            {users.map(u=>(
              <tr
                key={u.email}
                className="border-b border-slate-900"
              >

                <td className="py-3 text-xs text-slate-400">
                  {u.email}
                </td>

                <td>

                  <select
                    value={u.role}
                    onChange={(e)=>changeRole(u.user_id,e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                  >

                    <option value="admin">admin</option>
                    <option value="warehouse">warehouse</option>
                    <option value="viewer">viewer</option>

                  </select>

                </td>

                <td className="text-right">

                  <button
                    onClick={()=>removeUser(u.user_id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>

                </td>

              </tr>
            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}