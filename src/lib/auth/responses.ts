import { NextResponse } from "next/server";

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in required." }, { status: 401 });
}
