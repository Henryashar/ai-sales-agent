import { APIResponseError } from "@notionhq/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { notionInsertRequestSchema, notionInsertResponseSchema } from "@/lib/leads/schemas";
import { insertNewNotionLeads } from "@/lib/notion/leads";

export async function POST(request: Request) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = notionInsertRequestSchema.parse(body);
    const result = await insertNewNotionLeads(input, session.user);

    return NextResponse.json(notionInsertResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid insert request.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    if (error instanceof APIResponseError) {
      return NextResponse.json(
        {
          error: "Could not insert leads into Notion.",
          detail: error.message,
        },
        { status: error.status || 502 },
      );
    }

    return NextResponse.json(
      { error: "Unable to insert reviewed leads into Notion." },
      { status: 500 },
    );
  }
}
