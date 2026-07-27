import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { normalizeNaeaText } from "@/lib/leads/normalize";
import { normalizeRequestSchema, normalizeResponseSchema } from "@/lib/leads/schemas";

export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = normalizeRequestSchema.parse(body);
    const result = normalizeNaeaText(input.rawText);

    const response = normalizeResponseSchema.parse({
      ...result,
      defaults: {
        owner: input.owner,
        status: input.status,
        source: input.source,
        batchLabel: input.batchLabel,
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid normalize request.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Unable to normalize pasted NAEA text." },
      { status: 500 },
    );
  }
}
