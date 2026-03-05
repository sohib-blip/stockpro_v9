import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {

  const url = req.nextUrl.pathname;

  const protectedRoutes = [
    "/settings",
    "/settings/admin",
    "/settings/roles"
  ];

  if (protectedRoutes.some(r => url.startsWith(r))) {
    // ici on pourra vérifier le role
  }

  return NextResponse.next();
}