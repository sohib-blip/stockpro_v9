import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

export async function GET(request: Request) {

  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");

  if (code) {

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get() { return undefined },
          set() {},
          remove() {}
        }
      }
    );

    await supabase.auth.exchangeCodeForSession(code);

  }

  return NextResponse.redirect(`${origin}/dashboard`);

}