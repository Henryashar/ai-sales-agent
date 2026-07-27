import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { enrichLeadWithGooglePlaces } from "../google/places";
import { buildFirmDomainGuesses } from "../search/queries";
import { extractSearchSnippetCandidates } from "../search/snippets";
import { searchLeadWeb } from "../search/tavily";
import { crawlOfficialSites } from "../web/contacts";

export async function enrichLeadHybrid(lead: NormalizedLead) {
  const [placesCandidates, searchResults] = await Promise.all([
    enrichLeadWithGooglePlaces(lead).catch(() => []),
    searchLeadWeb(lead).catch(() => []),
  ]);
  const websiteCandidates = await crawlOfficialSites(lead, searchResults, buildFirmDomainGuesses(lead)).catch(() => []);
  const snippetCandidates = extractSearchSnippetCandidates(lead, searchResults);

  return suppressRedundantWeakSearchCandidates(mergeCandidates([...websiteCandidates, ...placesCandidates, ...snippetCandidates])).sort(
    (left, right) => right.confidenceScore - left.confidenceScore,
  );
}

export function pickLocationBackfill(candidates: EnrichmentCandidate[], minConfidenceScore = 70) {
  const candidate = candidates
    .filter((entry) => entry.confidenceScore >= minConfidenceScore)
    .filter((entry) => entry.city && entry.state)
    .sort((left, right) => right.confidenceScore - left.confidenceScore)[0];

  if (!candidate) {
    return undefined;
  }

  return {
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
    formattedAddress: candidate.formattedAddress,
    confidenceScore: candidate.confidenceScore,
    sourceType: candidate.sourceType,
    sourceUrls: candidate.sourceUrls,
  };
}

function mergeCandidates(candidates: EnrichmentCandidate[]) {
  const byWebsite = new Map<string, EnrichmentCandidate>();
  const merged: EnrichmentCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.website?.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

    if (!key) {
      merged.push(candidate);
      continue;
    }

    const existing = byWebsite.get(key);

    if (!existing) {
      byWebsite.set(key, candidate);
      merged.push(candidate);
      continue;
    }

    existing.phone ||= candidate.phone;
    existing.email ||= candidate.email;
    existing.googleMapsUrl ||= candidate.googleMapsUrl;
    existing.formattedAddress ||= candidate.formattedAddress;
    existing.city ||= candidate.city;
    existing.state ||= candidate.state;
    existing.zip ||= candidate.zip;
    existing.confidenceScore = Math.max(existing.confidenceScore, candidate.confidenceScore);
    existing.confidenceReason = Array.from(
      new Set([...existing.confidenceReason.split(", "), ...candidate.confidenceReason.split(", ")]),
    ).join(", ");
    existing.sourceUrls = Array.from(new Set([...existing.sourceUrls, ...candidate.sourceUrls]));
  }

  return merged.slice(0, 5);
}

function suppressRedundantWeakSearchCandidates(candidates: EnrichmentCandidate[]) {
  const authoritativeCandidates = candidates.filter(
    (candidate) =>
      candidate.confidenceScore >= 85 &&
      candidate.sourceType !== "web_search" &&
      Boolean(candidate.phone || candidate.email || (candidate.city && candidate.state)),
  );

  if (!authoritativeCandidates.length) {
    return candidates;
  }

  const hasAuthoritativeEmail = authoritativeCandidates.some((candidate) => candidate.email);

  return candidates.filter((candidate) => {
    if (candidate.sourceType !== "web_search" || candidate.confidenceScore > 72) {
      return true;
    }

    return Boolean(candidate.email && !hasAuthoritativeEmail);
  });
}
