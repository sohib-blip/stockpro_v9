import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { permissionsForApi } from "@/lib/access-control";
import { authorizeApiRequest } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    const response = NextResponse.next();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name) {
            return req.cookies.get(name)?.value;
          },
          set(name, value, options) {
            response.cookies.set(name, value, options);
          },
          remove(name, options) {
            response.cookies.set(name, "", options);
          },
        },
      }
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const isPublicAuthPage =
      req.nextUrl.pathname === "/login" ||
      req.nextUrl.pathname === "/set-password" ||
      req.nextUrl.pathname === "/reset-password" ||
      req.nextUrl.pathname.startsWith("/auth/");

    if (!session && !isPublicAuthPage) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    if (session && req.nextUrl.pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    return response;
  }

  const required = permissionsForApi(req.nextUrl.pathname, req.method);

  // The low-stock cron route has its own CRON_SECRET authentication.
  if (required === null) return NextResponse.next();

  // Fail closed: every newly added API route must be explicitly mapped.
  if (required.length === 0) {
    return NextResponse.json(
      { ok: false, error: "API route has no access policy" },
      { status: 403 }
    );
  }

  const authorization = await authorizeApiRequest(req, required);
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      { status: authorization.status }
    );
  }

  const headers = new Headers(req.headers);
  headers.set("x-stockpro-user-id", authorization.user.id);
  headers.set("x-stockpro-user-email", authorization.user.email ?? "");
  headers.set("x-stockpro-user-role", authorization.access.role ?? "");

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next|favicon.ico|api).*)"],
};
