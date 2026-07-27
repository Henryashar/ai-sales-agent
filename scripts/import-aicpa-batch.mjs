#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const LOCATION_ISSUE = "city/state not confidently found";
const PLACEHOLDER_CITIES = new Set(["", "TBD"]);
const PLACEHOLDER_STATES = new Set(["", "XX"]);
const MANUALLY_VERIFIED_LOCATION_LEAD_IDS = new Set(["aicpa-002", "aicpa-006", "aicpa-077"]);

const args = parseArgs(process.argv.slice(2));
loadDotEnvLocal();

const file = args.file;
const baseUrl = args["base-url"] ?? DEFAULT_BASE_URL;
const limit = args.limit ? Number(args.limit) : undefined;
const leadId = args.id;
const execute = Boolean(args.execute);
const shouldEnrich = Boolean(args.enrich) || !execute;
const runTimestamp = new Date().toISOString();
const importAudit =
  args["import-audit"] ??
  `Imported via AICPA ENGAGE screenshot extraction | batch=AICPA ENGAGE 2026 | run=${runTimestamp} | by=Henry`;

if (!file) {
  throw new Error("Usage: node scripts/import-aicpa-batch.mjs --file input/aicpa.json [--limit 4] [--execute]");
}

const cookie = args.cookie ?? (await signIn(baseUrl));
const rawLeads = JSON.parse(await readFileAsync(path.resolve(file), "utf8"));

if (!Array.isArray(rawLeads)) {
  throw new Error("Input file must be a JSON array.");
}

const selectedRawLeads = leadId ? rawLeads.filter((lead) => lead.id === leadId) : rawLeads;

if (leadId && selectedRawLeads.length === 0) {
  throw new Error(`No lead found with id ${leadId}.`);
}

const leads = (limit ? selectedRawLeads.slice(0, limit) : selectedRawLeads).map(normalizeLeadForAicpa);

console.log(`Loaded ${leads.length} lead(s) from ${file}.`);
console.log(`Mode: ${execute ? "EXECUTE EXPORT" : "DRY RUN - no Notion export write"}`);
console.log(`Enrichment: ${shouldEnrich ? "enabled" : "skipped"}`);

const dedupeResult = await postJson(baseUrl, "/api/dedupe", { leads }, cookie);
const decisions = dedupeResult.decisions;
const decisionCounts = countBy(decisions, (decision) => decision.action);

console.log("Dedupe decision counts:", {
  insert: decisionCounts.insert ?? 0,
  update_existing: decisionCounts.update_existing ?? 0,
  skip: decisionCounts.skip ?? 0,
  review: decisionCounts.review ?? 0,
});

const enrichments = [];
const updatedDecisions = [];
const enrichmentPlans = [];
const suspiciousMatches = [];

for (const decision of decisions) {
  if (decision.action !== "insert" && decision.action !== "update_existing") {
    updatedDecisions.push(decision);
    continue;
  }

  if (!shouldEnrich) {
    updatedDecisions.push(decision);
    continue;
  }

  const enrichmentLead = leadForEnrichment(decision.incomingLead);
  const enrichment = await postJson(baseUrl, "/api/enrich", { lead: enrichmentLead }, cookie);
  enrichments.push(enrichment);
  const locationBackfill = enrichment.locationBackfill;
  const locationPlan = planLocationBackfill(decision.incomingLead, locationBackfill);
  const incomingLead = locationBackfill
    ? applyLocationBackfill(decision.incomingLead, locationBackfill, locationPlan)
    : {
        ...decision.incomingLead,
        issues: Array.from(new Set([...(decision.incomingLead.issues ?? []), LOCATION_ISSUE])),
      };

  updatedDecisions.push({
    ...decision,
    incomingLead,
  });

  const topCandidate = enrichment.candidates?.[0];
  const exportCandidate = pickExportCandidate(enrichment.candidates ?? [], 70);
  const suspiciousMatch = topCandidate ? findSuspiciousMatch(decision.incomingLead, topCandidate) : undefined;

  if (suspiciousMatch) {
    suspiciousMatches.push(suspiciousMatch);
  }

  enrichmentPlans.push({
    leadId: decision.incomingLead.id,
    contactName: decision.incomingLead.contactName,
    firmName: decision.incomingLead.firmName,
    action: decision.action,
    matchedPageId: decision.matchedPageId,
    topCandidate: topCandidate
      ? {
          sourceType: topCandidate.sourceType,
          displayName: topCandidate.displayName,
          confidenceScore: topCandidate.confidenceScore,
          formattedAddress: topCandidate.formattedAddress,
          city: topCandidate.city,
          state: topCandidate.state,
          phone: topCandidate.phone,
          email: topCandidate.email,
          website: topCandidate.website,
        }
      : undefined,
    exportCandidate: exportCandidate
      ? {
          sourceType: exportCandidate.sourceType,
          displayName: exportCandidate.displayName,
          confidenceScore: exportCandidate.confidenceScore,
          phone: exportCandidate.phone,
          email: exportCandidate.email,
          website: exportCandidate.website,
        }
      : undefined,
    willAddPhone: Boolean(exportCandidate?.phone && !decision.matchedLead?.phone),
    willAddEmail: Boolean(exportCandidate?.email && !decision.matchedLead?.email),
    willAddWebsite: Boolean(exportCandidate?.website && !decision.matchedLead?.website),
    locationBackfill: locationBackfill
      ? {
          city: locationBackfill.city,
          state: locationBackfill.state,
          zip: locationBackfill.zip,
          formattedAddress: locationBackfill.formattedAddress,
          confidenceScore: locationBackfill.confidenceScore,
          sourceType: locationBackfill.sourceType,
          sourceUrls: locationBackfill.sourceUrls,
        }
      : undefined,
    locationPlan,
  });

  console.log("Enrichment result:", {
    leadId: decision.incomingLead.id,
    contactName: decision.incomingLead.contactName,
    firmName: decision.incomingLead.firmName,
    action: decision.action,
    topCandidate: topCandidate
      ? {
          sourceType: topCandidate.sourceType,
          displayName: topCandidate.displayName,
          confidenceScore: topCandidate.confidenceScore,
          formattedAddress: topCandidate.formattedAddress,
          city: topCandidate.city,
          state: topCandidate.state,
          phone: topCandidate.phone,
          email: topCandidate.email,
          website: topCandidate.website,
        }
      : undefined,
    locationBackfill: locationBackfill
      ? {
          city: locationBackfill.city,
          state: locationBackfill.state,
          zip: locationBackfill.zip,
          formattedAddress: locationBackfill.formattedAddress,
          confidenceScore: locationBackfill.confidenceScore,
          sourceType: locationBackfill.sourceType,
          sourceUrls: locationBackfill.sourceUrls,
        }
      : undefined,
    issues: incomingLead.issues,
  });
}

const missingLocation = updatedDecisions
  .map((decision) => decision.incomingLead)
  .filter((lead) => isMissingCity(lead.city) || isMissingState(lead.state))
  .map((lead) => ({
    id: lead.id,
    contactName: lead.contactName,
    firmName: lead.firmName,
    city: lead.city,
    state: lead.state,
    issues: lead.issues,
  }));
const contactUpdatePlans = enrichmentPlans.filter(
  (plan) => plan.willAddPhone || plan.willAddEmail || plan.willAddWebsite,
);
const manualLocationProtection = enrichmentPlans
  .filter((plan) => MANUALLY_VERIFIED_LOCATION_LEAD_IDS.has(plan.leadId))
  .map((plan) => ({
    leadId: plan.leadId,
    contactName: plan.contactName,
    firmName: plan.firmName,
    currentLocation: `${leads.find((lead) => lead.id === plan.leadId)?.city}, ${
      leads.find((lead) => lead.id === plan.leadId)?.state
    }`,
    locationBackfill: plan.locationBackfill,
    locationUpdate: plan.locationPlan,
  }));

const exportPayload = {
  decisions: updatedDecisions,
  defaults: {
    owner: args.owner ?? "Lisa White",
    status: args.status ?? "Cold List",
    source: "AICPA",
    batchLabel: args["batch-label"] ?? "AICPA ENGAGE 2026",
    importAudit,
  },
  enrichments,
  minConfidenceScore: 70,
  confirm: true,
};

if (!execute) {
  console.log("Dry run complete. Built export payload but did not POST /api/notion/export.");
  console.log("Final summary:", {
    inserted: 0,
    updated: 0,
    skipped: decisionCounts.skip ?? 0,
    review: decisionCounts.review ?? 0,
    exportableInsert: decisionCounts.insert ?? 0,
    exportableUpdateExisting: decisionCounts.update_existing ?? 0,
    leadsWithPhoneEmailWebsiteAdds: contactUpdatePlans.length,
    phoneAdds: contactUpdatePlans.filter((plan) => plan.willAddPhone).length,
    emailAdds: contactUpdatePlans.filter((plan) => plan.willAddEmail).length,
    websiteAdds: contactUpdatePlans.filter((plan) => plan.willAddWebsite).length,
  });
  console.log("Suspicious firm-name mismatches:", suspiciousMatches);
  console.log("Phone/email/website update plan:", contactUpdatePlans);
  console.log("Manual city/state overwrite protections:", manualLocationProtection);
  console.log("Leads still missing city/state after enrichment:", missingLocation);
  process.exit(0);
}

const exportResult = await postJson(baseUrl, "/api/notion/export", exportPayload, cookie);
const inserted = exportResult.inserted ?? [];
const updated = exportResult.updated ?? [];
const skipped = exportResult.skipped ?? [];
const failed = exportResult.failed ?? [];

console.log("Notion export summary:", {
  inserted: inserted.length,
  updated: updated.length,
  skipped: skipped.length,
  failed: failed.length,
  review: decisionCounts.review ?? 0,
});
console.log("Notion export defaults written:", exportPayload.defaults);
console.log(
  "Notion export records:",
  [...inserted, ...updated].map((record) => ({
    leadId: record.leadId,
    contactName: record.contactName,
    firmName: record.firmName,
    pageId: record.pageId,
    url: record.url,
    owner: exportPayload.defaults.owner,
    source: exportPayload.defaults.source,
    importAudit: exportPayload.defaults.importAudit,
    result: inserted.some((insertedRecord) => insertedRecord.leadId === record.leadId) ? "inserted" : "updated",
  })),
);
console.log("Notion export skipped:", skipped);
console.log("Notion export failed:", failed);
console.log("Complete Notion response:", JSON.stringify(exportResult, null, 2));
console.log("Leads still missing city/state after enrichment:", missingLocation);

function normalizeLeadForAicpa(input) {
  const rawSourceText = input.rawSourceText ?? JSON.stringify(input);

  return {
    id: input.id ?? makeLeadId(input),
    contactName: requiredString(input.contactName, "contactName"),
    firmName: requiredString(input.firmName, "firmName"),
    credential: input.credential ?? input.title ?? input.passType,
    city: normalizeRequiredCity(input.city),
    state: normalizeRequiredState(input.state),
    zip: input.zip,
    country: input.country ?? "United States",
    rawSourceText,
    source: "AICPA",
    parseConfidence: input.parseConfidence ?? 100,
    issues: input.issues ?? [],
  };
}

function leadForEnrichment(lead) {
  return {
    ...lead,
    city: isMissingCity(lead.city) ? "" : lead.city,
    state: isMissingState(lead.state) ? "" : lead.state,
  };
}

function applyLocationBackfill(lead, locationBackfill, locationPlan = planLocationBackfill(lead, locationBackfill)) {
  return {
    ...lead,
    city: locationPlan.willUpdateCity ? locationBackfill.city : lead.city,
    state: locationPlan.willUpdateState ? locationBackfill.state : lead.state,
    zip: locationPlan.willUpdateZip ? locationBackfill.zip : lead.zip,
  };
}

function planLocationBackfill(lead, locationBackfill) {
  const manuallyVerified = MANUALLY_VERIFIED_LOCATION_LEAD_IDS.has(lead.id);
  const hasLocationBackfill = Boolean(locationBackfill?.city && locationBackfill?.state);
  const placeholderLocation = isMissingCity(lead.city) || isMissingState(lead.state);
  const willUpdateLocation = Boolean(hasLocationBackfill && placeholderLocation && !manuallyVerified);

  return {
    manuallyVerified,
    placeholderLocation,
    willUpdateCity: Boolean(willUpdateLocation && locationBackfill?.city && isMissingCity(lead.city)),
    willUpdateState: Boolean(willUpdateLocation && locationBackfill?.state && isMissingState(lead.state)),
    willUpdateZip: Boolean(willUpdateLocation && locationBackfill?.zip && !lead.zip),
    reason: manuallyVerified
      ? "manual location protected"
      : !hasLocationBackfill
        ? "no confident locationBackfill"
        : placeholderLocation
          ? "would backfill placeholder city/state"
          : "existing city/state is not placeholder",
  };
}

function pickExportCandidate(candidates, minConfidenceScore = 70) {
  return candidates
    .filter((candidate) => candidate.confidenceScore >= minConfidenceScore)
    .filter((candidate) => candidate.phone || candidate.email || candidate.website)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];
}

function findSuspiciousMatch(lead, candidate) {
  if (!candidate.displayName) {
    return undefined;
  }

  const leadTokens = significantFirmTokens(lead.firmName);
  const candidateTokens = significantFirmTokens(candidate.displayName);
  const overlap = leadTokens.filter((token) => candidateTokens.includes(token));
  const overlapRatio = leadTokens.length ? overlap.length / leadTokens.length : 0;

  if (leadTokens.length < 2 || overlapRatio >= 0.5) {
    return undefined;
  }

  return {
    leadId: lead.id,
    contactName: lead.contactName,
    firmName: lead.firmName,
    candidateDisplayName: candidate.displayName,
    candidateWebsite: candidate.website,
    confidenceScore: candidate.confidenceScore,
    sourceType: candidate.sourceType,
    leadTokens,
    candidateTokens,
    overlap,
    reason: "low firm-name token overlap with top enrichment candidate",
  };
}

function significantFirmTokens(value) {
  const stopWords = new Set([
    "a",
    "and",
    "associates",
    "company",
    "consulting",
    "corporation",
    "cpa",
    "cpas",
    "ea",
    "financial",
    "firm",
    "group",
    "inc",
    "llc",
    "pa",
    "pc",
    "pllc",
    "tax",
    "the",
  ]);

  return Array.from(
    new Set(
      stringValue(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !stopWords.has(token)),
    ),
  );
}

function normalizeRequiredCity(value) {
  const city = stringValue(value);
  return city || "TBD";
}

function normalizeRequiredState(value) {
  const state = stringValue(value).toUpperCase();
  return state.length === 2 ? state : "XX";
}

function isMissingCity(value) {
  return PLACEHOLDER_CITIES.has(stringValue(value).toUpperCase());
}

function isMissingState(value) {
  return PLACEHOLDER_STATES.has(stringValue(value).toUpperCase());
}

function makeLeadId(input) {
  return [input.contactName, input.firmName, input.city, input.state, input.zip]
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function requiredString(value, field) {
  const text = stringValue(value);

  if (!text) {
    throw new Error(`Missing required field: ${field}`);
  }

  return text;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function postJson(baseUrl, route, payload, cookie) {
  const response = await fetch(new URL(route, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`${route} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function signIn(baseUrl) {
  const name = process.env.AICPA_IMPORT_NAME || "AICPA Import";
  const email = process.env.AICPA_IMPORT_EMAIL || "aicpa-import@example.local";
  const code = process.env.AICPA_IMPORT_CODE ?? process.env.APP_ACCESS_TOKEN;

  if (!code) {
    throw new Error("Provide --cookie or set AICPA_IMPORT_CODE or APP_ACCESS_TOKEN in the environment.");
  }

  const formData = new FormData();
  formData.set("name", name);
  formData.set("email", email);
  formData.set("code", code);
  formData.set("from", "/");

  const response = await fetch(new URL("/api/auth/sign-in", baseUrl), {
    method: "POST",
    redirect: "manual",
    body: formData,
  });

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error(`/api/auth/sign-in did not return a session cookie; status ${response.status}`);
  }

  return setCookie.split(";")[0];
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (!value.startsWith("--")) {
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function loadDotEnvLocal() {
  let content;

  try {
    content = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([^#][^=]+)=(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const key = match[1].trim();
    let value = match[2].trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}
