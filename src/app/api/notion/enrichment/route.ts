import { APIResponseError } from "@notionhq/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { notionEnrichmentUpdateRequestSchema, notionEnrichmentUpdateResponseSchema } from "@/lib/leads/schemas";
import { updateNotionLeadEnrichment } from "@/lib/notion/leads";

export async function POST(request: Request) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = notionEnrichmentUpdateRequestSchema.parse(body);
    const result = await updateNotionLeadEnrichment(input, session.user);

    return NextResponse.json(notionEnrichmentUpdateResponseSchema.parse(result));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid enrichment update request.",
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
          error: "Could not update Notion enrichment fields.",
          detail: error.message,
        },
        { status: error.status || 502 },
      );
    }

    return NextResponse.json({ error: "Unable to update Notion enrichment fields." }, { status: 500 });
  }
}
