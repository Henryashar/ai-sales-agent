import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { enrichLeadHybrid, pickLocationBackfill } from "@/lib/enrichment/hybrid";
import { enrichmentRequestSchema, enrichmentResponseSchema } from "@/lib/leads/schemas";

export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = enrichmentRequestSchema.parse(body);
    const candidates = await enrichLeadHybrid(input.lead);
    const locationBackfill = pickLocationBackfill(candidates);

    return NextResponse.json(
      enrichmentResponseSchema.parse({
        leadId: input.lead.id,
        candidates,
        locationBackfill,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid enrichment request.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to enrich lead.",
      },
      { status: 500 },
    );
  }
}
