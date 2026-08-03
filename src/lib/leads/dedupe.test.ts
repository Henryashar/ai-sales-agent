import { describe, expect, it } from "vitest";

import { dedupeLeads, scoreLeadMatch } from "./dedupe";
import type { NormalizedLead, NotionLead } from "./schemas";

const incomingLead: NormalizedLead = {
  id: "maryjanelinkthetaxlinksealbeachca907404522",
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

describe("dedupeLeads", () => {
  it("inserts when there is no match", () => {
    const decisions = dedupeLeads([incomingLead], []);

    expect(decisions[0]).toMatchObject({
      action: "insert",
      matchScore: 0,
    });
  });

  it("updates an exact existing record when enrichment fields are missing", () => {
    const existingLead: NotionLead = {
      pageId: "page-1",
      contactName: "MaryJane Link",
      firmName: "The Tax Link",
      city: "Seal Beach",
      state: "CA",
      zip: "90740-4522",
    };

    const decisions = dedupeLeads([incomingLead], [existingLead]);

    expect(decisions[0]).toMatchObject({
      action: "update_existing",
      matchedPageId: "page-1",
      matchScore: 98,
    });
  });

  it("skips an exact enriched existing record", () => {
    const existingLead: NotionLead = {
      pageId: "page-1",
      contactName: "MaryJane Link",
      firmName: "The Tax Link",
      city: "Seal Beach",
      state: "CA",
      zip: "90740-4522",
      phone: "562-555-0100",
      email: "hello@example.com",
      website: "https://example.com",
    };

    const decisions = dedupeLeads([incomingLead], [existingLead]);

    expect(decisions[0].action).toBe("skip");
  });

  it("does not treat same firm with different contact as an automatic duplicate", () => {
    const score = scoreLeadMatch(incomingLead, {
      pageId: "page-2",
      contactName: "Jordan Smith",
      firmName: "The Tax Link",
      city: "Seal Beach",
      state: "CA",
      zip: "90740-4522",
    });

    expect(score.score).toBeLessThan(70);
    expect(score.reason).toContain("same firm but different contact");
  });

  it("does not attach weak closest matches to insert decisions", () => {
    const decisions = dedupeLeads(
      [incomingLead],
      [
        {
          pageId: "page-3",
          contactName: "Lawrence Sam",
          firmName: "Lawrence Sam",
          city: "Harbor City",
          state: "CA",
        },
      ],
    );

    expect(decisions[0]).toMatchObject({
      action: "insert",
      matchScore: 8,
    });
    expect(decisions[0].matchedLead).toBeUndefined();
    expect(decisions[0].matchReason).toContain("Closest weak overlap");
  });

  it("treats matching enrichment email as a definitive duplicate", () => {
    const existingLead: NotionLead = {
      pageId: "page-email",
      contactName: "Other Person",
      firmName: "Different Firm",
      city: "Austin",
      state: "TX",
      email: "Mary@Example.com",
      phone: "512-555-0100",
      website: "https://example.com",
    };

    const decisions = dedupeLeads(
      [incomingLead],
      [existingLead],
      new Map([[incomingLead.id, { email: "mary@example.com" }]]),
    );

    expect(decisions[0]).toMatchObject({
      action: "skip",
      matchedPageId: "page-email",
      matchScore: 100,
      matchReason: "same email",
    });
  });

  it("updates an email match when enrichment fields are missing", () => {
    const existingLead: NotionLead = {
      pageId: "page-email-partial",
      contactName: "Other Person",
      firmName: "Different Firm",
      city: "Austin",
      state: "TX",
      email: "mary@example.com",
    };

    const decisions = dedupeLeads(
      [incomingLead],
      [existingLead],
      new Map([[incomingLead.id, { email: "mary@example.com", phone: "206-555-0100" }]]),
    );

    expect(decisions[0]).toMatchObject({
      action: "update_existing",
      matchedPageId: "page-email-partial",
      matchScore: 100,
    });
  });

  it("treats matching enrichment phone as a definitive duplicate", () => {
    const score = scoreLeadMatch(
      incomingLead,
      {
        pageId: "page-phone",
        contactName: "Other Person",
        firmName: "Different Firm",
        city: "Austin",
        state: "TX",
        phone: "(206) 555-0100",
      },
      { phone: "206-555-0100" },
    );

    expect(score).toEqual({
      score: 100,
      reason: "same phone",
    });
  });
});
