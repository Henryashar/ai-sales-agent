import { describe, expect, it } from "vitest";

import type { NormalizedLead } from "../leads/schemas";
import { extractSearchSnippetCandidates } from "./snippets";

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

describe("extractSearchSnippetCandidates", () => {
  it("creates review candidates from strong public snippets", () => {
    const candidates = extractSearchSnippetCandidates(lead, [
      {
        title: "MAQUE ENTERPRISE CORPORATION - Facebook",
        url: "https://www.facebook.com/MaqueEnterpriseCorp/",
        content: "MAQUE ENTERPRISE CORPORATION contact info. (657) 235-5084. info@maqueenterprise.com",
        query: "maque phone",
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceType: "web_search",
      phone: "(657) 235-5084",
      email: "info@maqueenterprise.com",
      website: "https://maqueenterprise.com",
      confidenceScore: 72,
    });
    expect(candidates[0].confidenceReason).toContain("review before using");
  });

  it("rejects snippets that only contain bad phone-shaped numbers", () => {
    const candidates = extractSearchSnippetCandidates(lead, [
      {
        title: "MAQUE ENTERPRISE CORPORATION | BBB",
        url: "https://www.bbb.org/us/ca/los-angeles/profile/accountant/maque",
        content: "Coordinates 112.0598397 for MAQUE ENTERPRISE CORPORATION",
        query: "maque",
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("rejects unrelated contact snippets", () => {
    const candidates = extractSearchSnippetCandidates(lead, [
      {
        title: "P.F. Chang's",
        url: "https://example.com/pf-changs",
        content: "Restaurant phone (562) 202-7120 in Cerritos, CA",
        query: "david chang",
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("rejects lead-broker snippets even when the firm name appears", () => {
    const candidates = extractSearchSnippetCandidates(lead, [
      {
        title: "Maque Enterprise - Overview, News & Similar companies | ZoomInfo",
        url: "https://www.zoominfo.com/c/maque-enterprise-corp/510657811",
        content: "MAQUE ENTERPRISE CORPORATION Los Angeles phone (714) 477-1010",
        query: "maque phone",
      },
    ]);

    expect(candidates).toEqual([]);
  });

  it("infers an official site when the host matches enough firm tokens", () => {
    const candidates = extractSearchSnippetCandidates(
      { ...lead, firmName: "Hidalgo Bookkeeping & Taxes LLC", city: "Bellflower", zip: "90706" },
      [
        {
          title: "Privacy Policy | Hidalgo Bookkeeping and Taxes",
          url: "https://www.hidalgobookkeeping.com/privacy-policy",
          content: "Hidalgo Bookkeeping and Taxes Bellflower CA phone (562) 500-4757",
          query: "hidalgo",
        },
      ],
    );

    expect(candidates[0]).toMatchObject({
      website: "https://www.hidalgobookkeeping.com",
    });
    expect(candidates[0].confidenceReason).not.toContain("off-domain");
  });
});
