import { describe, expect, it } from "vitest";

import { mapPlaceDetailsToCandidate } from "./places";
import type { NormalizedLead } from "../leads/schemas";

const lead: NormalizedLead = {
  id: "lead-1",
  contactName: "MaryJane Link",
  firmName: "The Tax Link",
  city: "Seal Beach",
  state: "CA",
  zip: "90740-4522",
  country: "United States",
  rawSourceText: "raw",
  source: "NAEA",
  parseConfidence: 100,
  issues: [],
};

describe("mapPlaceDetailsToCandidate", () => {
  it("maps Google place details into an enrichment candidate", () => {
    const candidate = mapPlaceDetailsToCandidate(lead, {
      id: "places/abc123",
      displayName: { text: "The Tax Link" },
      formattedAddress: "123 Main St, Seal Beach, CA 90740, USA",
      nationalPhoneNumber: "(562) 555-0100",
      websiteUri: "https://example.com",
      googleMapsUri: "https://maps.google.com/?cid=123",
      businessStatus: "OPERATIONAL",
      types: ["accounting"],
    });

    expect(candidate).toMatchObject({
      placeId: "places/abc123",
      displayName: "The Tax Link",
      phone: "(562) 555-0100",
      website: "https://example.com",
      confidenceScore: 100,
    });
    expect(candidate.sourceUrls).toEqual(["https://example.com", "https://maps.google.com/?cid=123"]);
    expect(candidate.confidenceReason).toContain("firm name appears");
  });

  it("caps candidates that do not match the firm name", () => {
    const candidate = mapPlaceDetailsToCandidate(lead, {
      id: "places/other",
      displayName: { text: "Different Tax Firm" },
      formattedAddress: "123 Main St, Seal Beach, CA 90740, USA",
      nationalPhoneNumber: "(562) 555-0100",
      websiteUri: "https://example.com",
      googleMapsUri: "https://maps.google.com/?cid=123",
      businessStatus: "OPERATIONAL",
      types: ["accounting"],
    });

    expect(candidate.confidenceScore).toBeLessThan(50);
    expect(candidate.confidenceReason).toContain("firm name not found");
  });

  it("pushes irrelevant non-accounting candidates below the visible threshold", () => {
    const candidate = mapPlaceDetailsToCandidate(
      { ...lead, contactName: "David Chang", firmName: "David Chang" },
      {
        id: "places/pf-changs",
        displayName: { text: "P.F. Chang's" },
        formattedAddress: "360 Los Cerritos Center C15, Cerritos, CA 90703, USA",
        nationalPhoneNumber: "(562) 202-7120",
        websiteUri: "https://www.pfchangs.com/",
        googleMapsUri: "https://maps.google.com/?cid=123",
        businessStatus: "OPERATIONAL",
        types: ["restaurant", "food"],
      },
    );

    expect(candidate.confidenceScore).toBeLessThan(50);
    expect(candidate.confidenceReason).toContain("business category is not tax/accounting");
  });

  it("keeps weak out-of-area firm-ish matches below the visible threshold", () => {
    const candidate = mapPlaceDetailsToCandidate(lead, {
      id: "places/out-of-area",
      displayName: { text: "Tax Link" },
      formattedAddress: "2335 W Foothill Blvd #16, Upland, CA 91786, USA",
      nationalPhoneNumber: "(909) 621-1982",
      websiteUri: "https://example.com",
      googleMapsUri: "https://maps.google.com/?cid=123",
      businessStatus: "OPERATIONAL",
      types: ["accounting"],
    });

    expect(candidate.confidenceScore).toBeLessThan(60);
  });

  it("recognizes firm matches when legal suffixes differ", () => {
    const candidate = mapPlaceDetailsToCandidate(
      {
        ...lead,
        contactName: "Juan Diego Hidalgo Cossio",
        firmName: "Hidalgo Bookkeeping & Taxes LLC",
        city: "Bellflower",
        zip: "90706",
      },
      {
        id: "places/hidalgo",
        displayName: { text: "Hidalgo Bookkeeping & Taxes" },
        formattedAddress: "16600 Woodruff Ave Suite 308, Bellflower, CA 90706, USA",
        nationalPhoneNumber: "(562) 500-4757",
        websiteUri: "https://hidalgobookkeeping.com",
        googleMapsUri: "https://maps.google.com/?cid=123",
        businessStatus: "OPERATIONAL",
        types: ["accounting"],
      },
    );

    expect(candidate.confidenceScore).toBe(100);
    expect(candidate.confidenceReason).toContain("firm name appears");
  });
});
