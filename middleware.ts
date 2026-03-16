import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {

  const session = request.cookies.get("sb-access-token")

  // si pas connecté → login
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbound/:path*",
    "/outbound/:path*",
    "/history/:path*"
  ]
}