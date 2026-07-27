import { Client } from "@notionhq/client";

import { formatActor, type AuthUser } from "../auth/session";
import type {
  EnrichmentCandidate,
  LeadSource,
  LeadStatus,
  NormalizedLead,
  NotionEnrichmentUpdateRequest,
  NotionExportRequest,
  NotionInsertRequest,
  NotionLead,
  Owner,
} from "../leads/schemas";
import { normalizeNotionId } from "./ids";

const PAGE_SIZE = 100;
const MAX_EXISTING_LEADS = 1_000;
type PageUpdateProperties = NonNullable<Parameters<Client["pages"]["update"]>[0]["properties"]>;

export async function listNotionLeads(): Promise<NotionLead[]> {
  const auth = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;

  if (!auth || !dataSourceId) {
    throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID.");
  }

  const notion = new Client({ auth });
  const normalizedDataSourceId = normalizeNotionId(dataSourceId);
  const leads: NotionLead[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: normalizedDataSourceId,
      page_size: PAGE_SIZE,
      start_cursor: cursor,
    });

    for (const page of response.results) {
      const lead = mapPageToNotionLead(page);

      if (lead) {
        leads.push(lead);
      }

      if (leads.length >= MAX_EXISTING_LEADS) {
        return leads;
      }
    }

    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  return leads;
}

export async function insertNewNotionLeads(input: NotionInsertRequest, actor?: AuthUser) {
  const auth = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;

  if (!auth || !dataSourceId) {
    throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID.");
  }

  const notion = new Client({ auth });
  const normalizedDataSourceId = normalizeNotionId(dataSourceId);
  const inserted: Array<{
    leadId: string;
    pageId: string;
    url?: string;
    firmName: string;
    contactName: string;
  }> = [];
  const skipped: Array<{ leadId: string; reason: string }> = [];

  for (const decision of input.decisions) {
    if (decision.action !== "insert") {
      skipped.push({
        leadId: decision.incomingLead.id,
        reason: `Decision was ${decision.action}, not insert.`,
      });
      continue;
    }

    const page = await notion.pages.create({
      parent: {
        type: "data_source_id",
        data_source_id: normalizedDataSourceId,
      },
      properties: buildCreateLeadProperties(decision.incomingLead, input.defaults, actor),
    });

    inserted.push({
      leadId: decision.incomingLead.id,
      pageId: page.id,
      url: "url" in page && typeof page.url === "string" ? page.url : undefined,
      firmName: decision.incomingLead.firmName,
      contactName: decision.incomingLead.contactName,
    });
  }

  return { inserted, skipped };
}

export async function updateNotionLeadEnrichment(input: NotionEnrichmentUpdateRequest, actor?: AuthUser) {
  const auth = process.env.NOTION_API_KEY;

  if (!auth) {
    throw new Error("Missing NOTION_API_KEY.");
  }

  const notion = new Client({ auth });
  const existingPage = await notion.pages.retrieve({ page_id: normalizeNotionId(input.pageId) });
  const existingLead = mapPageToNotionLead(existingPage);
  const properties = buildEnrichmentUpdateProperties(input.candidate, existingLead, actor);
  const updatedFields = Object.keys(properties);

  if (updatedFields.length) {
    await notion.pages.update({
      page_id: normalizeNotionId(input.pageId),
      properties,
    });
  }

  return { pageId: input.pageId, updatedFields };
}

export async function exportNotionLeads(input: NotionExportRequest, actor?: AuthUser) {
  const auth = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;

  if (!auth || !dataSourceId) {
    throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID.");
  }

  const notion = new Client({ auth });
  const normalizedDataSourceId = normalizeNotionId(dataSourceId);
  const candidatesByLeadId = new Map(
    input.enrichments.map((entry) => [entry.leadId, pickExportCandidate(entry.candidates, input.minConfidenceScore)]),
  );
  const locationBackfillsByLeadId = new Map(input.enrichments.map((entry) => [entry.leadId, entry.locationBackfill]));
  const inserted: Array<{
    leadId: string;
    pageId: string;
    url?: string;
    firmName: string;
    contactName: string;
    enrichmentFields: string[];
  }> = [];
  const updated: Array<{
    leadId: string;
    pageId: string;
    url?: string;
    firmName: string;
    contactName: string;
    enrichmentFields: string[];
  }> = [];
  const skipped: Array<{ leadId: string; reason: string }> = [];
  const failed: Array<{ leadId: string; firmName: string; contactName: string; error: string }> = [];

  for (const decision of input.decisions) {
    const lead = applyLocationBackfill(decision.incomingLead, locationBackfillsByLeadId.get(decision.incomingLead.id));
    const candidate = candidatesByLeadId.get(lead.id);

    try {
      if (decision.action === "insert") {
        const createProperties = buildCreateLeadProperties(lead, input.defaults, actor);
        const enrichmentProperties = candidate ? buildEnrichmentUpdateProperties(candidate) : {};
        const page = await notion.pages.create({
          parent: {
            type: "data_source_id",
            data_source_id: normalizedDataSourceId,
          },
          properties: {
            ...createProperties,
            ...enrichmentProperties,
          },
        });

        inserted.push({
          leadId: lead.id,
          pageId: page.id,
          url: "url" in page && typeof page.url === "string" ? page.url : undefined,
          firmName: lead.firmName,
          contactName: lead.contactName,
          enrichmentFields: Object.keys(enrichmentProperties),
        });
        continue;
      }

      if (decision.action === "update_existing") {
        if (!decision.matchedPageId) {
          skipped.push({ leadId: lead.id, reason: "Matched Notion page ID was missing." });
          continue;
        }

        const existingPage = await notion.pages.retrieve({ page_id: normalizeNotionId(decision.matchedPageId) });
        const existingLead = mapPageToNotionLead(existingPage);
        const properties = {
          ...buildLocationUpdateProperties(lead, existingLead),
          ...buildImportAuditUpdateProperties(input.defaults),
          ...(candidate ? buildEnrichmentUpdateProperties(candidate, existingLead, actor) : {}),
        };
        const enrichmentFields = Object.keys(properties);

        if (!candidate && !enrichmentFields.length) {
          skipped.push({ leadId: lead.id, reason: "No enrichment candidate met the export threshold." });
          continue;
        }

        if (enrichmentFields.length) {
          await notion.pages.update({
            page_id: normalizeNotionId(decision.matchedPageId),
            properties,
          });
        }

        updated.push({
          leadId: lead.id,
          pageId: decision.matchedPageId,
          url: "url" in existingPage && typeof existingPage.url === "string" ? existingPage.url : undefined,
          firmName: lead.firmName,
          contactName: lead.contactName,
          enrichmentFields,
        });
        continue;
      }

      skipped.push({ leadId: lead.id, reason: `Decision was ${decision.action}.` });
    } catch (error) {
      failed.push({
        leadId: lead.id,
        firmName: lead.firmName,
        contactName: lead.contactName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { inserted, updated, skipped, failed };
}

function applyLocationBackfill(
  lead: NormalizedLead,
  locationBackfill: NotionExportRequest["enrichments"][number]["locationBackfill"],
) {
  if (!locationBackfill) {
    return {
      ...lead,
      issues: Array.from(new Set([...lead.issues, "city/state not confidently found"])),
    };
  }

  return {
    ...lead,
    city: isPlaceholderCity(lead.city) ? (locationBackfill.city ?? lead.city) : lead.city,
    state: isPlaceholderState(lead.state) ? (locationBackfill.state ?? lead.state) : lead.state,
    zip: locationBackfill.zip ?? lead.zip,
  };
}

function buildLocationUpdateProperties(lead: NormalizedLead, existingLead?: NotionLead) {
  const properties: PageUpdateProperties = {};

  if (lead.city && lead.city !== existingLead?.city) {
    properties.City = richTextProperty(lead.city);
  }

  if (lead.state && lead.state !== existingLead?.state) {
    properties.State = selectProperty(lead.state);
  }

  if (lead.zip && lead.zip !== existingLead?.zip) {
    properties.ZIP = richTextProperty(lead.zip);
  }

  return properties;
}

export function buildCreateLeadProperties(
  lead: NormalizedLead,
  defaults: { owner: Owner; status: LeadStatus; source: LeadSource; batchLabel?: string; importAudit?: string },
  actor?: AuthUser,
) {
  const notes = [
    lead.credential ? `Credential: ${lead.credential}.` : undefined,
    defaults.batchLabel ? `Batch: ${defaults.batchLabel}.` : undefined,
    actor ? auditNote("Exported", actor) : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    "Firm Name": titleProperty(lead.firmName),
    "Contact Name": richTextProperty(lead.contactName),
    City: richTextProperty(lead.city),
    State: selectProperty(lead.state),
    ZIP: richTextProperty(lead.zip ?? ""),
    Owner: selectProperty(defaults.owner),
    Status: selectProperty(defaults.status),
    Source: selectProperty(defaults.source),
    "Import Audit": richTextProperty(defaults.importAudit ?? ""),
    "Call Notes": richTextProperty(notes),
  };
}

function buildImportAuditUpdateProperties(defaults: { importAudit?: string }) {
  const properties: PageUpdateProperties = {};

  if (defaults.importAudit) {
    properties["Import Audit"] = richTextProperty(defaults.importAudit);
  }

  return properties;
}

export function buildEnrichmentUpdateProperties(
  candidate: EnrichmentCandidate,
  existingLead?: NotionLead,
  actor?: AuthUser,
) {
  const properties: PageUpdateProperties = {};

  if (candidate.phone && !existingLead?.phone) {
    properties.Phone = {
      type: "phone_number" as const,
      phone_number: candidate.phone,
    };
  }

  if (candidate.email && !existingLead?.email) {
    properties.Email = {
      type: "email" as const,
      email: candidate.email,
    };
  }

  if (candidate.website && !existingLead?.website) {
    properties.Website = {
      type: "url" as const,
      url: candidate.website,
    };
  }

  if (actor && Object.keys(properties).length) {
    properties["Call Notes"] = richTextProperty(appendNote(existingLead?.callNotes, auditNote("Updated", actor)));
  }

  return properties;
}

export function pickExportCandidate(candidates: EnrichmentCandidate[], minConfidenceScore = 70) {
  return candidates
    .filter((candidate) => candidate.confidenceScore >= minConfidenceScore)
    .filter((candidate) => candidate.phone || candidate.email || candidate.website)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
}

export function mapPageToNotionLead(page: unknown): NotionLead | undefined {
  if (!isRecord(page) || page.object !== "page" || typeof page.id !== "string" || !isRecord(page.properties)) {
    return undefined;
  }

  const properties = page.properties;
  const firmName = readPropertyText(properties, ["Firm Name", "Company", "Organization", "Name"]);

  if (!firmName) {
    return undefined;
  }

  return {
    pageId: page.id,
    firmName,
    contactName: readPropertyText(properties, ["Contact Name", "Contact", "Person", "Name"]),
    city: readPropertyText(properties, ["City"]),
    state: readPropertyText(properties, ["State"]),
    zip: readPropertyText(properties, ["ZIP", "Zip", "Postal Code"]),
    phone: readPropertyText(properties, ["Phone", "Phone Number"]),
    email: readPropertyText(properties, ["Email"]),
    website: readPropertyText(properties, ["Website", "URL", "Web"]),
    callNotes: readPropertyText(properties, ["Call Notes", "Notes"]),
  };
}

function auditNote(action: "Exported" | "Updated", actor: AuthUser) {
  return `${action} by ${formatActor(actor)} on ${new Date().toISOString()}.`;
}

function appendNote(existingNote: string | undefined, nextNote: string) {
  return [existingNote?.trim(), nextNote].filter(Boolean).join("\n");
}

function readPropertyText(properties: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const property = properties[name];
    const value = readTextValue(property);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function readTextValue(property: unknown): string | undefined {
  if (!isRecord(property) || typeof property.type !== "string") {
    return undefined;
  }

  switch (property.type) {
    case "title":
      return readRichTextArray(property.title);
    case "rich_text":
      return readRichTextArray(property.rich_text);
    case "phone_number":
      return stringOrUndefined(property.phone_number);
    case "email":
      return stringOrUndefined(property.email);
    case "url":
      return stringOrUndefined(property.url);
    case "select":
      return isRecord(property.select) ? stringOrUndefined(property.select.name) : undefined;
    case "status":
      return isRecord(property.status) ? stringOrUndefined(property.status.name) : undefined;
    default:
      return undefined;
  }
}

function readRichTextArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((item) => (isRecord(item) ? stringOrUndefined(item.plain_text) : undefined))
    .filter(Boolean)
    .join("")
    .trim();

  return text || undefined;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlaceholderCity(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();

  return !normalized || normalized === "TBD";
}

function isPlaceholderState(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();

  return !normalized || normalized === "XX";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function titleProperty(content: string) {
  return {
    type: "title" as const,
    title: [{ type: "text" as const, text: { content } }],
  };
}

function richTextProperty(content: string) {
  return {
    type: "rich_text" as const,
    rich_text: content ? [{ type: "text" as const, text: { content } }] : [],
  };
}

function selectProperty(name: string) {
  return {
    type: "select" as const,
    select: { name },
  };
}
