import { NextResponse, type NextRequest } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const session = getSessionFromRequest(request);

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("from", pathname);

  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
