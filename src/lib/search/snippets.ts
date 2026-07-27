import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { cleanEmails, cleanPhones, EMAIL_PATTERN, PHONE_PATTERN } from "../web/contacts";
import { normalizeName } from "./queries";
import type { WebSearchResult } from "./tavily";

const LOW_TRUST_HOST_PARTS = [
  "bbb.org",
  "mapquest.com",
  "zoominfo.com",
  "toptaxhq.com",
  "chamber",
  "yelp.",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "yellowpages.",
  "glaaacc.org",
];
const BLOCKED_SNIPPET_HOST_PARTS = ["zoominfo.com", "bomforge.com"];

const GENERIC_EMAIL_DOMAINS = ["facebook.com", "linkedin.com", "instagram.com", "yelp.com", "bbb.org"];
const IRRELEVANT_BUSINESS_TERMS = [
  "manufacturing",
  "manufacturer",
  "supplier",
  "wholesale",
  "importer",
  "exporter",
  "industrial",
];

export function extractSearchSnippetCandidates(
  lead: NormalizedLead,
  searchResults: WebSearchResult[],
): EnrichmentCandidate[] {
  const candidates: EnrichmentCandidate[] = [];

  for (const result of searchResults) {
    if (isBlockedSnippetHost(result.url)) {
      continue;
    }

    const phones = cleanPhones(result.content?.match(PHONE_PATTERN) ?? []);
    const emails = cleanEmails(result.content?.match(EMAIL_PATTERN) ?? []).filter((email) =>
      isRelevantEmail(lead, email),
    );

    if (!phones.length && !emails.length) {
      continue;
    }

    const match = scoreSnippetMatch(lead, result, phones, emails);

    if (match.score < 55) {
      continue;
    }

    const officialWebsite = inferOfficialWebsite(lead, result, emails);

    candidates.push({
      placeId: `search:${result.url}`,
      sourceType: "web_search",
      displayName: result.title,
      phone: phones[0],
      email: emails[0],
      website: officialWebsite,
      confidenceScore: match.score,
      confidenceReason: match.reason,
      sourceUrls: [result.url],
    });
  }

  return mergeSnippetCandidates(candidates)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)
    .slice(0, 4);
}

function scoreSnippetMatch(lead: NormalizedLead, result: WebSearchResult, phones: string[], emails: string[]) {
  const reasons: string[] = [];
  const text = [result.title, result.url, result.content ?? ""].join(" ");
  const normalizedText = normalizeName(text);
  const titleAndUrl = [result.title, result.url].join(" ");
  const firmInTitleOrUrl = hasMeaningfulFirmOverlap(lead.firmName, normalizeName(titleAndUrl));
  const officialHostMatch = hasOfficialHostMatch(lead, result.url);
  const firmMatch = hasMeaningfulFirmOverlap(lead.firmName, normalizedText);
  const contactMatch = hasContactMatch(lead.contactName, normalizedText);
  const locationMatch = hasLocationMatch(lead, text);
  const lowTrustHost = isLowTrustHost(result.url);
  let score = 35;

  if (hasIrrelevantBusinessTerms(text)) {
    return {
      score: 0,
      reason: "search result appears to describe an unrelated business category",
    };
  }

  if (lowTrustHost && !firmInTitleOrUrl) {
    return {
      score: 0,
      reason: "third-party listing does not identify the firm strongly enough",
    };
  }

  if (firmMatch) {
    score += 25;
    reasons.push("search result matches firm name");
  }

  if (contactMatch) {
    score += 10;
    reasons.push("search result mentions contact name");
  }

  if (locationMatch) {
    score += 10;
    reasons.push("location signal appears in result");
  }

  if (phones.length) {
    score += 10;
    reasons.push("public phone appears in search snippet");
  }

  if (emails.length) {
    score += 10;
    reasons.push("public email appears in search snippet");
  }

  if (lowTrustHost) {
    score = Math.min(score, 72);
    reasons.push("third-party or social listing; review before using");
  }

  if (!officialHostMatch && !lowTrustHost) {
    score = Math.min(score, 72);
    reasons.push("off-domain search result; review before using");
  }

  if (!firmMatch && !contactMatch) {
    score = 0;
  }

  if (!firmMatch && !locationMatch) {
    score = Math.min(score, 50);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reason: reasons.join(", ") || "public search snippet match",
  };
}

function mergeSnippetCandidates(candidates: EnrichmentCandidate[]) {
  const byContact = new Map<string, EnrichmentCandidate>();

  for (const candidate of candidates) {
    const key = [candidate.phone ?? "", candidate.email ?? "", candidate.website ?? ""].join("|");
    const existing = byContact.get(key);

    if (!existing) {
      byContact.set(key, candidate);
      continue;
    }

    existing.confidenceScore = Math.max(existing.confidenceScore, candidate.confidenceScore);
    existing.sourceUrls = Array.from(new Set([...existing.sourceUrls, ...candidate.sourceUrls]));
    existing.confidenceReason = Array.from(
      new Set([...existing.confidenceReason.split(", "), ...candidate.confidenceReason.split(", ")]),
    ).join(", ");
  }

  return Array.from(byContact.values());
}

function inferOfficialWebsite(lead: NormalizedLead, result: WebSearchResult, emails: string[]) {
  for (const email of emails) {
    const domain = email.split("@")[1];

    if (domain && hasMeaningfulFirmOverlap(lead.firmName, normalizeName(domain))) {
      return `https://${domain}`;
    }
  }

  try {
    if (!isLowTrustHost(result.url) && hasOfficialHostMatch(lead, result.url)) {
      return new URL(result.url).origin;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRelevantEmail(lead: NormalizedLead, email: string) {
  if (GENERIC_EMAIL_DOMAINS.some((domain) => email.endsWith(`@${domain}`))) {
    return false;
  }

  const domain = email.split("@")[1] ?? "";
  return hasMeaningfulFirmOverlap(lead.firmName, normalizeName(domain));
}

function hasOfficialHostMatch(lead: NormalizedLead, url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const normalizedHost = normalizeName(host);
    const matches = firmNameTokens(lead.firmName).filter((token) => normalizedHost.includes(token));
    return matches.length >= Math.min(2, firmNameTokens(lead.firmName).length);
  } catch {
    return false;
  }
}

function hasIrrelevantBusinessTerms(text: string) {
  const normalizedText = text.toLowerCase();
  return IRRELEVANT_BUSINESS_TERMS.some((term) => normalizedText.includes(term));
}

function hasMeaningfulFirmOverlap(firmName: string, normalizedText: string) {
  const tokens = firmNameTokens(firmName);
  return tokens.length > 0 && tokens.every((token) => normalizedText.includes(token));
}

function hasContactMatch(contactName: string, normalizedText: string) {
  const tokens = contactName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  return tokens.length >= 2 && tokens.every((token) => normalizedText.includes(token));
}

function hasLocationMatch(lead: NormalizedLead, text: string) {
  const normalizedText = text.toLowerCase();
  return Boolean(
    (lead.city && normalizedText.includes(lead.city.toLowerCase())) ||
      (lead.zip && normalizedText.includes(lead.zip.slice(0, 5))) ||
      normalizedText.includes(` ${lead.state.toLowerCase()} `) ||
      normalizedText.includes(`, ${lead.state.toLowerCase()}`),
  );
}

function isLowTrustHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOW_TRUST_HOST_PARTS.some((hostPart) => host.includes(hostPart));
  } catch {
    return true;
  }
}

function isBlockedSnippetHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_SNIPPET_HOST_PARTS.some((hostPart) => host.includes(hostPart));
  } catch {
    return true;
  }
}

function firmNameTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .filter((token) => !["corporation", "company", "services", "service", "inc", "llc", "corp", "the"].includes(token))
    .map((token) => normalizeName(token));
}
