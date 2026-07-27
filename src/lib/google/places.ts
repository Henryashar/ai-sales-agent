import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { parseCityStateFromAddress } from "../location/address";

const PLACES_BASE_URL = "https://places.googleapis.com/v1/places";
const SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.types";
const DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,businessStatus,types";
const RELEVANT_TYPES = new Set(["accounting", "finance", "tax_preparation_service"]);
const IRRELEVANT_TYPES = new Set([
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "bar",
  "cafe",
  "doctor",
  "hospital",
  "health",
]);
const MIN_VISIBLE_CONFIDENCE = 60;

type GooglePlaceSearchResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  businessStatus?: string;
  types?: string[];
};

type GooglePlaceDetails = GooglePlaceSearchResult & {
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
};

export async function enrichLeadWithGooglePlaces(lead: NormalizedLead): Promise<EnrichmentCandidate[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GOOGLE_PLACES_API_KEY.");
  }

  if (isPersonNameOnlyLead(lead)) {
    return [];
  }

  const places = await searchPlaces(apiKey, lead);
  const candidates: EnrichmentCandidate[] = [];

  for (const place of places.slice(0, 3)) {
    if (!place.id) {
      continue;
    }

    const details = await getPlaceDetails(apiKey, place.id);
    const candidate = mapPlaceDetailsToCandidate(lead, details);

    if (candidate.confidenceScore >= MIN_VISIBLE_CONFIDENCE) {
      candidates.push(candidate);
    }
  }

  return candidates.sort((left, right) => right.confidenceScore - left.confidenceScore);
}

async function searchPlaces(apiKey: string, lead: NormalizedLead) {
  const response = await fetch(`${PLACES_BASE_URL}:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: [lead.firmName, "tax accountant CPA enrolled agent", lead.city, lead.state, lead.zip]
        .filter(Boolean)
        .join(" "),
      maxResultCount: 5,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places search failed: ${response.status}`);
  }

  const payload = (await response.json()) as { places?: GooglePlaceSearchResult[] };
  return payload.places ?? [];
}

async function getPlaceDetails(apiKey: string, placeId: string) {
  const response = await fetch(`${PLACES_BASE_URL}/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Places details failed: ${response.status}`);
  }

  return (await response.json()) as GooglePlaceDetails;
}

export function mapPlaceDetailsToCandidate(lead: NormalizedLead, place: GooglePlaceDetails): EnrichmentCandidate {
  const displayName = place.displayName?.text ?? "";
  const phone = place.nationalPhoneNumber ?? place.internationalPhoneNumber;
  const sourceUrls = [place.websiteUri, place.googleMapsUri].filter((url): url is string => Boolean(url));
  const scoring = scorePlaceCandidate(lead, place);
  const parsedAddress = parseCityStateFromAddress(place.formattedAddress ?? "");

  return {
    placeId: place.id ?? "",
    sourceType: "google_places",
    displayName,
    formattedAddress: place.formattedAddress,
    city: parsedAddress?.city,
    state: parsedAddress?.state,
    zip: parsedAddress?.zip,
    phone,
    website: place.websiteUri,
    googleMapsUrl: place.googleMapsUri,
    businessStatus: place.businessStatus,
    confidenceScore: scoring.score,
    confidenceReason: scoring.reason,
    sourceUrls,
  };
}

function scorePlaceCandidate(lead: NormalizedLead, place: GooglePlaceDetails) {
  const reasons: string[] = [];
  let score = 20;
  const displayName = place.displayName?.text ?? "";
  const address = place.formattedAddress ?? "";
  const types = place.types ?? [];
  const hasFirmNameMatch = nameIncludes(displayName, lead.firmName) || hasMeaningfulTokenOverlap(lead.firmName, displayName);
  const hasRelevantType = types.some((type) => RELEVANT_TYPES.has(type));
  const hasIrrelevantType = types.some((type) => IRRELEVANT_TYPES.has(type));
  const hasCityMatch = address.toLowerCase().includes(lead.city.toLowerCase());
  const hasZipMatch = Boolean(lead.zip && address.includes(lead.zip.slice(0, 5)));

  if (hasFirmNameMatch) {
    score += 35;
    reasons.push("firm name appears in Google place name");
  } else {
    reasons.push("firm name not found in Google place name");
  }

  if (hasCityMatch) {
    score += 20;
    reasons.push("city matches");
  }

  if (hasZipMatch) {
    score += 15;
    reasons.push("ZIP matches");
  }

  if (hasRelevantType) {
    score += 10;
    reasons.push("business category is relevant");
  }

  if (hasIrrelevantType) {
    score -= 45;
    reasons.push("business category is not tax/accounting");
  }

  if (place.websiteUri) {
    score += 10;
    reasons.push("website available");
  }

  if (place.nationalPhoneNumber || place.internationalPhoneNumber) {
    score += 10;
    reasons.push("phone available");
  }

  if (place.businessStatus === "CLOSED_PERMANENTLY") {
    score -= 40;
    reasons.push("business is closed permanently");
  }

  if (!hasFirmNameMatch) {
    score = Math.min(score, 49);
  }

  if (!hasFirmNameMatch && !hasRelevantType) {
    score = Math.min(score, 49);
  }

  if (hasFirmNameMatch && !hasCityMatch && !hasZipMatch) {
    score = Math.min(score, 59);
    reasons.push("location does not match lead");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reason: reasons.length ? reasons.join(", ") : "low-confidence Places candidate",
  };
}

function isPersonNameOnlyLead(lead: NormalizedLead) {
  return normalizeName(lead.contactName) === normalizeName(lead.firmName);
}

function nameIncludes(displayName: string, firmName: string) {
  const normalizedDisplay = normalizeName(displayName);
  const normalizedFirm = normalizeName(firmName);

  return Boolean(normalizedFirm) && normalizedDisplay.includes(normalizedFirm);
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasMeaningfulTokenOverlap(firmName: string, displayName: string) {
  const normalizedDisplay = normalizeName(displayName);
  const tokens = firmName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .filter((token) => !["corporation", "company", "services", "service", "inc", "llc", "the"].includes(token));

  return tokens.length > 0 && tokens.every((token) => normalizedDisplay.includes(token));
}
