import { APIResponseError } from "@notionhq/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { notionExportRequestSchema, notionExportResponseSchema } from "@/lib/leads/schemas";
import { exportNotionLeads } from "@/lib/notion/leads";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = notionExportRequestSchema.parse(body);
    const result = await exportNotionLeads(input, session.user);

    return NextResponse.json(notionExportResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid export request.",
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
          error: "Could not export leads to Notion.",
          detail: error.message,
        },
        { status: error.status || 502 },
      );
    }

    return NextResponse.json({ error: "Unable to export leads to Notion." }, { status: 500 });
  }
}
