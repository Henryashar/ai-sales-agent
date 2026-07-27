import { NextResponse } from "next/server";

import { authenticateUser, authIsConfigured, createSessionCookie, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth/session";

export async function POST(request: Request) {
  const formData = await request.formData();
  const from = safeRedirectPath(formData.get("from"));

  if (!authIsConfigured()) {
    return redirectWithError(request, "config", from);
  }

  const user = authenticateUser({
    name: stringValue(formData.get("name")),
    email: stringValue(formData.get("email")),
    code: stringValue(formData.get("code")),
  });

  if (!user) {
    return redirectWithError(request, "invalid", from);
  }

  const response = NextResponse.redirect(new URL(from, request.url), { status: 303 });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionCookie(user),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return response;
}

function redirectWithError(request: Request, error: string, from: string) {
  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("error", error);
  signInUrl.searchParams.set("from", from);

  return NextResponse.redirect(signInUrl, { status: 303 });
}

function safeRedirectPath(value: FormDataEntryValue | null) {
  const path = stringValue(value);

  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/api/")) {
    return "/";
  }

  return path;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
