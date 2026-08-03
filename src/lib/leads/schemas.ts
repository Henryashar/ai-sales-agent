import { z } from "zod";

export const ownerSchema = z.enum(["Lisa", "Tamar", "Dawn", "Henry"]);

export const leadSourceSchema = z.enum(["NAEA", "IRS RPO", "AICPA", "Cold", "Referral", "Chamber", "Other"]);

export const leadStatusSchema = z.enum(["Cold List", "Lead"]);

export const normalizedLeadSchema = z.object({
  id: z.string(),
  contactName: z.string().min(1),
  firmName: z.string().min(1),
  credential: z.string().optional(),
  city: z.string().min(1),
  state: z.string().length(2),
  zip: z.string().optional(),
  country: z.string().optional(),
  rawSourceText: z.string().min(1),
  source: z.enum(["NAEA", "AICPA"]),
  parseConfidence: z.number().min(0).max(100),
  issues: z.array(z.string()),
});

export const notionLeadSchema = z.object({
  pageId: z.string(),
  firmName: z.string(),
  contactName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  callNotes: z.string().optional(),
});

export const dedupeDecisionSchema = z.object({
  incomingLead: normalizedLeadSchema,
  action: z.enum(["insert", "update_existing", "skip", "review"]),
  matchedLead: notionLeadSchema.optional(),
  matchedPageId: z.string().optional(),
  matchScore: z.number().min(0).max(100),
  matchReason: z.string(),
});

export const normalizeRequestSchema = z.object({
  rawText: z.string().min(1, "Paste at least one NAEA lead block."),
  owner: ownerSchema.default("Henry"),
  status: leadStatusSchema.default("Cold List"),
  source: leadSourceSchema.default("NAEA"),
  batchLabel: z.string().optional(),
});

export const normalizeResponseSchema = z.object({
  leads: z.array(normalizedLeadSchema),
  rejectedBlocks: z.array(
    z.object({
      rawSourceText: z.string(),
      issues: z.array(z.string()),
    }),
  ),
  defaults: z.object({
    owner: ownerSchema,
    status: leadStatusSchema,
    source: leadSourceSchema,
    batchLabel: z.string().optional(),
  }),
});

export const dedupeRequestSchema = z.object({
  leads: z.array(normalizedLeadSchema),
  destination: z.enum(["hubspot", "notion"]).default("hubspot"),
});

export const dedupeResponseSchema = z.object({
  decisions: z.array(dedupeDecisionSchema),
  existingCount: z.number().min(0),
});

export const notionInsertRequestSchema = z.object({
  decisions: z.array(dedupeDecisionSchema),
  defaults: z.object({
    owner: ownerSchema,
    status: leadStatusSchema,
    source: leadSourceSchema,
    batchLabel: z.string().optional(),
    importAudit: z.string().optional(),
  }),
  confirm: z.literal(true),
});

export const notionInsertResponseSchema = z.object({
  inserted: z.array(
    z.object({
      leadId: z.string(),
      pageId: z.string(),
      url: z.string().optional(),
      firmName: z.string(),
      contactName: z.string(),
    }),
  ),
  skipped: z.array(
    z.object({
      leadId: z.string(),
      reason: z.string(),
    }),
  ),
});

export const enrichmentRequestSchema = z.object({
  lead: normalizedLeadSchema.extend({
    city: z.string().optional().default(""),
    state: z.string().optional().default(""),
  }),
});

export const enrichmentCandidateSchema = z.object({
  placeId: z.string(),
  sourceType: z.enum(["google_places", "web_search", "official_site", "website_contact_page"]),
  displayName: z.string(),
  formattedAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().length(2).optional(),
  zip: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  googleMapsUrl: z.string().optional(),
  businessStatus: z.string().optional(),
  confidenceScore: z.number().min(0).max(100),
  confidenceReason: z.string(),
  sourceUrls: z.array(z.string()),
});

export const enrichmentResponseSchema = z.object({
  leadId: z.string(),
  candidates: z.array(enrichmentCandidateSchema),
  locationBackfill: z
    .object({
      city: z.string().optional(),
      state: z.string().length(2).optional(),
      zip: z.string().optional(),
      formattedAddress: z.string().optional(),
      confidenceScore: z.number().min(0).max(100),
      sourceType: z.enum(["google_places", "web_search", "official_site", "website_contact_page"]).optional(),
      sourceUrls: z.array(z.string()),
    })
    .optional(),
});

export const notionEnrichmentUpdateRequestSchema = z.object({
  pageId: z.string().min(1),
  candidate: enrichmentCandidateSchema,
  confirm: z.literal(true),
});

export const notionEnrichmentUpdateResponseSchema = z.object({
  pageId: z.string(),
  updatedFields: z.array(z.string()),
});

export const notionExportRequestSchema = z.object({
  decisions: z.array(dedupeDecisionSchema),
  defaults: z.object({
    owner: ownerSchema,
    status: leadStatusSchema,
    source: leadSourceSchema,
    batchLabel: z.string().optional(),
    importAudit: z.string().optional(),
  }),
  enrichments: z.array(enrichmentResponseSchema).default([]),
  minConfidenceScore: z.number().min(0).max(100).default(70),
  confirm: z.literal(true),
});

export const notionExportResponseSchema = z.object({
  inserted: z.array(
    z.object({
      leadId: z.string(),
      pageId: z.string(),
      url: z.string().optional(),
      firmName: z.string(),
      contactName: z.string(),
      enrichmentFields: z.array(z.string()),
    }),
  ),
  updated: z.array(
    z.object({
      leadId: z.string(),
      pageId: z.string(),
      url: z.string().optional(),
      firmName: z.string(),
      contactName: z.string(),
      enrichmentFields: z.array(z.string()),
    }),
  ),
  skipped: z.array(
    z.object({
      leadId: z.string(),
      reason: z.string(),
    }),
  ),
  failed: z
    .array(
      z.object({
        leadId: z.string(),
        firmName: z.string(),
        contactName: z.string(),
        error: z.string(),
      }),
    )
    .default([]),
});

export type Owner = z.infer<typeof ownerSchema>;
export type LeadSource = z.infer<typeof leadSourceSchema>;
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type NormalizedLead = z.infer<typeof normalizedLeadSchema>;
export type NotionLead = z.infer<typeof notionLeadSchema>;
export type DedupeDecision = z.infer<typeof dedupeDecisionSchema>;
export type NormalizeRequest = z.infer<typeof normalizeRequestSchema>;
export type NormalizeResponse = z.infer<typeof normalizeResponseSchema>;
export type DedupeRequest = z.infer<typeof dedupeRequestSchema>;
export type DedupeResponse = z.infer<typeof dedupeResponseSchema>;
export type NotionInsertRequest = z.infer<typeof notionInsertRequestSchema>;
export type NotionInsertResponse = z.infer<typeof notionInsertResponseSchema>;
export type EnrichmentRequest = z.infer<typeof enrichmentRequestSchema>;
export type EnrichmentCandidate = z.infer<typeof enrichmentCandidateSchema>;
export type EnrichmentResponse = z.infer<typeof enrichmentResponseSchema>;
export type NotionEnrichmentUpdateRequest = z.infer<typeof notionEnrichmentUpdateRequestSchema>;
export type NotionEnrichmentUpdateResponse = z.infer<typeof notionEnrichmentUpdateResponseSchema>;
export type NotionExportRequest = z.infer<typeof notionExportRequestSchema>;
export type NotionExportResponse = z.infer<typeof notionExportResponseSchema>;
