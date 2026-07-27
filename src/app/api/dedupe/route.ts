import { APIResponseError } from "@notionhq/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dedupeLeads } from "@/lib/leads/dedupe";
import { dedupeRequestSchema, dedupeResponseSchema } from "@/lib/leads/schemas";
import { listNotionLeads } from "@/lib/notion/leads";

export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = dedupeRequestSchema.parse(body);
    const existingLeads = await listNotionLeads();

    const response = dedupeResponseSchema.parse({
      decisions: dedupeLeads(input.leads, existingLeads),
      existingCount: existingLeads.length,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid dedupe request.",
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
          error: "Could not read the Notion CRM.",
          detail: error.message,
        },
        { status: error.status || 502 },
      );
    }

    return NextResponse.json(
      { error: "Unable to dedupe leads against Notion." },
      { status: 500 },
    );
  }
}
