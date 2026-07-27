import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { unauthorizedResponse } from "@/lib/auth/responses";

export function GET(request: Request) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return unauthorizedResponse();
  }

  return NextResponse.json({ user: session.user });
}
