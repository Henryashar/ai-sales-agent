import { describe, expect, it } from "vitest";

import { cleanPhones, mapExtractionToCandidate, pickLikelyOfficialUrls } from "./contacts";
import { parseCityStateFromAddress } from "../location/address";
import type { NormalizedLead } from "../leads/schemas";

const lead: NormalizedLead = {
  id: "lead-1",
  contactName: "Jacob McKeithan",
  firmName: "MAQUE ENTERPRISE CORPORATION",
  city: "Los Angeles",
  state: "CA",
  zip: "90001",
  rawSourceText: "raw",
  source: "NAEA",
  parseConfidence: 100,
  issues: [],
};

describe("pickLikelyOfficialUrls", () => {
  it("selects likely official result URLs", () => {
    const urls = pickLikelyOfficialUrls(lead, [
      {
        title: "Maque Enterprise - Accounting and Tax Services",
        url: "https://maqueenterprise.com/",
        content: "Payroll and tax services",
        query: "maque",
      },
      {
        title: "Unrelated Directory",
        url: "https://example.org/",
        content: "other",
        query: "maque",
      },
    ]);

    expect(urls).toEqual(["https://maqueenterprise.com/"]);
  });

  it("rejects directory and map hosts as official sites", () => {
    const urls = pickLikelyOfficialUrls(lead, [
      {
        title: "MAQUE ENTERPRISE CORPORATION - MapQuest",
        url: "https://www.mapquest.com/us/california/maque-enterprise-corporation",
        content: "MAQUE ENTERPRISE CORPORATION",
        query: "maque",
      },
      {
        title: "MAQUE ENTERPRISE CORPORATION | BBB",
        url: "https://www.bbb.org/us/ca/los-angeles/profile/accountant/maque",
        content: "MAQUE ENTERPRISE CORPORATION",
        query: "maque",
      },
      {
        title: "MAQUE ENTERPRISE CORPORATION - ZoomInfo",
        url: "https://www.zoominfo.com/c/maque-enterprise-corporation/123",
        content: "MAQUE ENTERPRISE CORPORATION",
        query: "maque",
      },
    ]);

    expect(urls).toEqual([]);
  });
});

describe("cleanPhones", () => {
  it("formats valid US phones and rejects coordinate-shaped numbers", () => {
    expect(cleanPhones(["(424) 449-2589", "1 562 863 4808", "112.0598397"])).toEqual([
      "(424) 449-2589",
      "(562) 863-4808",
    ]);
  });
});

describe("parseCityStateFromAddress", () => {
  it("extracts city and state from a US mailing address", () => {
    expect(parseCityStateFromAddress("Contact us at 50 Lake Avenue, Worcester, MA 01604.")).toEqual({
      formattedAddress: "50 Lake Avenue, Worcester, MA 01604",
      city: "Worcester",
      state: "MA",
      zip: "01604",
    });
  });

  it("extracts city and state when the street and city are not comma-separated", () => {
    expect(parseCityStateFromAddress("Location 3100 Independence Dr. Suite 100 Birmingham, AL 35209")).toEqual({
      formattedAddress: "3100 Independence Dr. Suite 100 Birmingham, AL 35209",
      city: "Birmingham",
      state: "AL",
      zip: "35209",
    });
  });
});

describe("mapExtractionToCandidate", () => {
  it("creates a high-confidence contact-page candidate", () => {
    const candidate = mapExtractionToCandidate(lead, {
      url: "https://maqueenterprise.com",
      title: "MAQUE ENTERPRISE CORPORATION",
      phone: "(424) 449-2589",
      email: "info@maqueenterprise.com",
      formattedAddress: "123 Main St, Los Angeles, CA 90001",
      city: "Los Angeles",
      state: "CA",
      zip: "90001",
      contactPageUrl: "https://maqueenterprise.com/contact",
      sourceUrls: ["https://maqueenterprise.com", "https://maqueenterprise.com/contact"],
    });

    expect(candidate).toMatchObject({
      sourceType: "website_contact_page",
      formattedAddress: "123 Main St, Los Angeles, CA 90001",
      city: "Los Angeles",
      state: "CA",
      zip: "90001",
      phone: "(424) 449-2589",
      email: "info@maqueenterprise.com",
      confidenceScore: 100,
    });
  });
});
