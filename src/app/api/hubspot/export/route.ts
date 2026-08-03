import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { unauthorizedResponse } from "@/lib/auth/responses";
import { getSessionFromRequest } from "@/lib/auth/session";
import { HubSpotApiError, type HubSpotContact } from "@/lib/hubspot/client";
import { findHubSpotLeadsForDedupe } from "@/lib/hubspot/dedupe";
import { exportHubSpotContact, type HubSpotExportResult } from "@/lib/hubspot/export";
import { dedupeLeads } from "@/lib/leads/dedupe";
import {
  notionExportRequestSchema,
  type EnrichmentCandidate,
  type NotionLead,
  type NormalizedLead,
} from "@/lib/leads/schemas";

export const maxDuration = 60;

type LeadExportResult = HubSpotExportResult & {
  leadId: string;
  contactName: string;
  firmName: string;
};

export async function POST(request: Request) {
  if (!getSessionFromRequest(request)) {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const input = notionExportRequestSchema.parse(body);
    const candidatesByLeadId = new Map(
      input.enrichments.map((entry) => [
        entry.leadId,
        pickBestCandidate(entry.candidates, input.minConfidenceScore),
      ]),
    );
    const results: LeadExportResult[] = [];
    const claimedEmails = new Map<string, string>();

    for (const incomingDecision of input.decisions) {
      const lead = incomingDecision.incomingLead;
      const candidate = candidatesByLeadId.get(lead.id);
      const contactHints = {
        email: candidate?.email,
        phone: candidate?.phone,
      };
      const existingLeads = await findHubSpotLeadsForDedupe(lead, contactHints);
      const [decision] = dedupeLeads(
        [lead],
        existingLeads,
        new Map([[lead.id, contactHints]]),
      );

      const normalizedEmail = candidate?.email?.trim().toLowerCase();
      if (decision.action === "insert" && normalizedEmail && claimedEmails.has(normalizedEmail)) {
        results.push(
          withLeadDetails(lead, {
            success: true,
            hubspotId: claimedEmails.get(normalizedEmail) ?? "",
            action: "skipped",
          }),
        );
        continue;
      }

      if (decision.action === "insert") {
        const exportResult = await exportHubSpotContact(
          lead,
          candidate,
          undefined,
          input.defaults.source,
          input.defaults.batchLabel,
        );
        if (normalizedEmail && exportResult.hubspotId) {
          claimedEmails.set(normalizedEmail, exportResult.hubspotId);
        }
        results.push(withLeadDetails(lead, exportResult));
        continue;
      }

      if (decision.action === "update_existing" && decision.matchedLead) {
        const existingContact = mapDedupeLeadToContact(decision.matchedLead);
        const exportResult = await exportHubSpotContact(
          lead,
          candidate,
          existingContact,
          input.defaults.source,
          input.defaults.batchLabel,
        );
        if (normalizedEmail && exportResult.hubspotId) {
          claimedEmails.set(normalizedEmail, exportResult.hubspotId);
        }
        results.push(withLeadDetails(lead, exportResult));
        continue;
      }

      if (normalizedEmail && decision.matchedPageId) {
        claimedEmails.set(normalizedEmail, decision.matchedPageId);
      }

      results.push(
        withLeadDetails(lead, {
          success: true,
          hubspotId: decision.matchedPageId ?? "",
          action: "skipped",
        }),
      );
    }

    if (results.length === 1) {
      return NextResponse.json(results[0]);
    }

    return NextResponse.json({
      success: results.every((result) => result.success),
      results,
    });
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

    if (error instanceof HubSpotApiError) {
      return NextResponse.json(
        {
          error: "Could not export leads to HubSpot.",
          detail: error.message,
        },
        { status: error.status || 502 },
      );
    }

    return NextResponse.json({ error: "Unable to export leads to HubSpot." }, { status: 500 });
  }
}

function pickBestCandidate(candidates: EnrichmentCandidate[], minConfidenceScore: number) {
  return candidates
    .filter((candidate) => candidate.confidenceScore >= minConfidenceScore)
    .filter((candidate) => candidate.phone || candidate.email || candidate.website)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
}

function mapDedupeLeadToContact(lead: NotionLead): HubSpotContact {
  const [firstname = "", ...lastNameParts] = (lead.contactName ?? "").trim().split(/\s+/);

  return {
    id: lead.pageId,
    properties: {
      firstname,
      lastname: lastNameParts.join(" "),
      company: lead.firmName,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
    },
  };
}

function withLeadDetails(lead: NormalizedLead, result: HubSpotExportResult): LeadExportResult {
  return {
    ...result,
    leadId: lead.id,
    contactName: lead.contactName,
    firmName: lead.firmName,
  };
}
