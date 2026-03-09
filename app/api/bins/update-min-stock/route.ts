import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req:Request){

 const { device_id, min_stock } = await req.json()

 const { error } = await supabase
  .from("bins")
  .update({ min_stock })
  .eq("device_id",device_id)

 if(error){
  return NextResponse.json({ ok:false,error:error.message })
 }

 return NextResponse.json({ ok:true })

}