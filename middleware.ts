import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function middleware(req: NextRequest) {

  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return req.cookies.get(name)?.value
        },
        set(name, value, options) {
          res.cookies.set(name, value, options)
        },
        remove(name, options) {
          res.cookies.set(name, "", options)
        },
      },
    }
  )

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const url = req.nextUrl.clone()

  // pas connecté → login
  if (!session && url.pathname !== "/login") {
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  // connecté → dashboard si accès login
  if (session && url.pathname === "/login") {
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|api).*)",
  ],
}