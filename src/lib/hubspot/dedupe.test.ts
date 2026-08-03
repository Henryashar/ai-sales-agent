import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedLead } from "../leads/schemas";
import { searchContacts } from "./client";
import { findHubSpotLeadsForDedupe } from "./dedupe";

vi.mock("./client", () => ({
  searchContacts: vi.fn(),
}));

const lead: NormalizedLead = {
  id: "lead-1",
  contactName: "Mary Jane Link",
  firmName: "The Tax Link",
  city: "Seattle",
  state: "WA",
  zip: "98101",
  rawSourceText: "raw",
  source: "NAEA",
  parseConfidence: 100,
  issues: [],
};

describe("findHubSpotLeadsForDedupe", () => {
  beforeEach(() => {
    vi.mocked(searchContacts).mockReset();
  });

  it("searches by company location and enrichment contact hints", async () => {
    vi.mocked(searchContacts).mockResolvedValue([
      {
        id: "contact-1",
        properties: {
          firstname: "Mary",
          lastname: "Link",
          company: "Other Co",
          city: "Austin",
          state: "TX",
          email: "mary@example.com",
          phone: "2065550100",
        },
      },
    ]);

    await expect(
      findHubSpotLeadsForDedupe(lead, {
        email: "mary@example.com",
        phone: "(206) 555-0100",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        pageId: "contact-1",
        email: "mary@example.com",
        phone: "2065550100",
      }),
    ]);

    expect(searchContacts).toHaveBeenCalledWith({
      company: "The Tax Link",
      city: "Seattle",
      state: "WA",
      email: "mary@example.com",
      phone: "(206) 555-0100",
    });
  });
});
