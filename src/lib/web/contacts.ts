import * as cheerio from "cheerio";
import { parse as parseDomain } from "tldts";

import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { parseCityStateFromAddress } from "../location/address";
import { normalizeName } from "../search/queries";
import type { WebSearchResult } from "../search/tavily";

const CRAWL_PATHS = ["/", "/contact", "/contact-us", "/about", "/our-team", "/team", "/locations"];
const PAGE_FETCH_TIMEOUT_MS = 3_500;
export const PHONE_PATTERN = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;
export const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BLOCKED_EMAIL_PARTS = ["example.com", "domain.com", "email.com"];
const BLOCKED_HOST_PARTS = [
  "bbb.org",
  "mapquest.com",
  "zoominfo.com",
  "toptaxhq.com",
  "chamber",
  "yelp.",
  "facebook.com",
  "linkedin.com",
  "yellowpages.",
  "glaaacc.org",
];

export type WebsiteContactExtraction = {
  url: string;
  title?: string;
  phone?: string;
  email?: string;
  formattedAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  contactPageUrl?: string;
  sourceUrls: string[];
};

export async function crawlOfficialSites(
  lead: NormalizedLead,
  searchResults: WebSearchResult[],
  extraUrls: string[] = [],
): Promise<EnrichmentCandidate[]> {
  const officialUrls = dedupeByHost([...pickLikelyOfficialUrls(lead, searchResults), ...extraUrls]).slice(0, 2);
  const extractions = await Promise.all(officialUrls.map((url) => crawlContactInfo(url)));
  const candidates = extractions
    .filter((extraction) => (extraction.phone || extraction.email || (extraction.city && extraction.state)) && isExtractionFirmMatch(lead, extraction))
    .map((extraction) => mapExtractionToCandidate(lead, extraction));

  return candidates.filter((candidate) => candidate.confidenceScore >= 60);
}

export function pickLikelyOfficialUrls(lead: NormalizedLead, searchResults: WebSearchResult[]) {
  const urls: string[] = [];

  for (const result of searchResults) {
    if (!isLikelyOfficialResult(lead, result)) {
      continue;
    }

    urls.push(result.url);
  }

  return dedupeByHost(urls);
}

export async function crawlContactInfo(startUrl: string): Promise<WebsiteContactExtraction> {
  let origin = toOrigin(startUrl);
  let canonicalOrigin = origin;
  const sourceUrls: string[] = [];
  let bestTitle: string | undefined;
  let bestPhone: string | undefined;
  let bestEmail: string | undefined;
  let bestAddress: WebsiteContactExtraction["formattedAddress"];
  let bestCity: WebsiteContactExtraction["city"];
  let bestState: WebsiteContactExtraction["state"];
  let bestZip: WebsiteContactExtraction["zip"];
  let contactPageUrl: string | undefined;

  for (const path of CRAWL_PATHS) {
    const url = new URL(path, origin).toString();
    const page = await fetchPage(url);

    if (!page) {
      continue;
    }

    canonicalOrigin = toOrigin(page.url);
    origin = canonicalOrigin;
    sourceUrls.push(page.url);
    bestTitle ||= page.title;
    bestPhone ||= page.phones[0];
    bestEmail ||= page.emails[0];
    bestAddress ||= page.address?.formattedAddress;
    bestCity ||= page.address?.city;
    bestState ||= page.address?.state;
    bestZip ||= page.address?.zip;

    if ((page.phones.length || page.emails.length || page.address) && path !== "/") {
      contactPageUrl = url;
    }

    if (bestPhone && bestEmail && bestCity && bestState) {
      break;
    }
  }

  return {
    url: canonicalOrigin,
    title: bestTitle,
    phone: bestPhone,
    email: bestEmail,
    formattedAddress: bestAddress,
    city: bestCity,
    state: bestState,
    zip: bestZip,
    contactPageUrl,
    sourceUrls,
  };
}

export function mapExtractionToCandidate(
  lead: NormalizedLead,
  extraction: WebsiteContactExtraction,
): EnrichmentCandidate {
  const scoring = scoreWebsiteCandidate(lead, extraction);

  return {
    placeId: `website:${extraction.url}`,
    sourceType: extraction.contactPageUrl ? "website_contact_page" : "official_site",
    displayName: extraction.title || extraction.url,
    formattedAddress: extraction.formattedAddress,
    city: extraction.city,
    state: extraction.state,
    zip: extraction.zip,
    phone: extraction.phone,
    email: extraction.email,
    website: extraction.url,
    confidenceScore: scoring.score,
    confidenceReason: scoring.reason,
    sourceUrls: extraction.sourceUrls,
  };
}

function isLikelyOfficialResult(lead: NormalizedLead, result: WebSearchResult) {
  if (isBlockedHost(result.url)) {
    return false;
  }

  const haystack = normalizeName([result.title, result.url, result.content ?? ""].join(" "));
  const host = normalizeName(new URL(result.url).hostname);
  const firm = normalizeName(lead.firmName);
  const contact = normalizeName(lead.contactName);

  if (firm.length > 6 && host.includes(firm)) {
    return true;
  }

  if (hasMeaningfulTokenOverlap(lead.firmName, host)) {
    return true;
  }

  if (contact.length > 6 && haystack.includes(contact) && /(tax|account|bookkeep|ea|enrolled)/i.test(result.content ?? result.title)) {
    return true;
  }

  return false;
}

function isBlockedHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOST_PARTS.some((blocked) => host.includes(blocked));
  } catch {
    return true;
  }
}

function hasMeaningfulTokenOverlap(value: string, normalizedHaystack: string) {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .filter((token) => !["corporation", "company", "services", "service", "inc", "llc", "the"].includes(token));

  return tokens.length > 0 && tokens.every((token) => normalizedHaystack.includes(token));
}

async function fetchPage(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 NAEA lead enrichment contact lookup",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
      return undefined;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim() || undefined;
    const text = $("body").text();
    const mailtoEmails = $("a[href^='mailto:']")
      .map((_, element) => $(element).attr("href")?.replace(/^mailto:/i, "").split("?")[0])
      .get();
    const emails = cleanEmails([...mailtoEmails, ...(text.match(EMAIL_PATTERN) ?? [])]);
    const phones = cleanPhones(text.match(PHONE_PATTERN) ?? []);
    const address = parseCityStateFromAddress(text);

    return { url: response.url, title, emails, phones, address };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

function scoreWebsiteCandidate(lead: NormalizedLead, extraction: WebsiteContactExtraction) {
  const reasons: string[] = [];
  let score = 45;
  const normalizedTitle = normalizeName(extraction.title ?? "");
  const normalizedUrl = normalizeName(extraction.url);

  if (normalizedTitle.includes(normalizeName(lead.firmName)) || normalizedUrl.includes(normalizeName(lead.firmName))) {
    score += 25;
    reasons.push("official site matches firm");
  }

  if (extraction.contactPageUrl) {
    score += 20;
    reasons.push("contact info found on contact/about page");
  } else {
    reasons.push("contact info found on official site");
  }

  if (extraction.email) {
    score += 10;
    reasons.push("public email found");
  }

  if (extraction.phone) {
    score += 10;
    reasons.push("public phone found");
  }

  if (extraction.city && extraction.state) {
    score += 15;
    reasons.push("mailing address found on official site");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reason: reasons.join(", "),
  };
}

function isExtractionFirmMatch(lead: NormalizedLead, extraction: WebsiteContactExtraction) {
  const title = normalizeName(extraction.title ?? "");
  const url = normalizeName(extraction.url);

  return (
    title.includes(normalizeName(lead.firmName)) ||
    url.includes(normalizeName(lead.firmName)) ||
    hasMeaningfulTokenOverlap(lead.firmName, title) ||
    hasMeaningfulTokenOverlap(lead.firmName, url)
  );
}

function toOrigin(url: string) {
  const parsed = new URL(url);
  return parsed.origin;
}

function dedupeByHost(urls: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const url of urls) {
    try {
      const parsed = parseDomain(url);
      const key = parsed.domain ?? new URL(url).hostname;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(url);
    } catch {
      continue;
    }
  }

  return deduped;
}

export function cleanEmails(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value && !BLOCKED_EMAIL_PARTS.some((blocked) => value.includes(blocked))),
    ),
  );
}

export function cleanPhones(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => {
          let digits = value.replace(/\D/g, "");

          if (digits.length === 11 && digits.startsWith("1")) {
            digits = digits.slice(1);
          }

          if (digits.length !== 10 || !/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
            return undefined;
          }

          return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        })
        .filter((value): value is string => Boolean(value)),
    ),
  );
}
