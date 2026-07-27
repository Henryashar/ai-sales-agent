import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { createContact, updateContact } from "./client";
import { exportHubSpotContact } from "./export";

vi.mock("./client", () => ({
  createContact: vi.fn(),
  updateContact: vi.fn(),
}));

const lead: NormalizedLead = {
  id: "lead-1",
  contactName: "Mary Jane Link",
  firmName: "The Tax Link",
  credential: "EA",
  city: "Seattle",
  state: "WA",
  zip: "98101",
  rawSourceText: "raw",
  source: "NAEA",
  parseConfidence: 100,
  issues: [],
};

const candidate: EnrichmentCandidate = {
  placeId: "place-1",
  sourceType: "google_places",
  displayName: "The Tax Link",
  phone: "(206) 555-0100",
  email: "mary@example.com",
  website: "https://example.com",
  confidenceScore: 95,
  confidenceReason: "Strong match",
  sourceUrls: [],
};

describe("exportHubSpotContact", () => {
  beforeEach(() => {
    vi.mocked(createContact).mockReset();
    vi.mocked(updateContact).mockReset();
  });

  it("creates a contact with names, enrichment, and timezone properties", async () => {
    vi.mocked(createContact).mockResolvedValue({ id: "contact-1" });

    await expect(exportHubSpotContact(lead, candidate)).resolves.toEqual({
      success: true,
      hubspotId: "contact-1",
      action: "inserted",
    });
    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        firstname: "Mary",
        lastname: "Jane Link",
        phone: candidate.phone,
        time_zone: "Pacific",
        likely_calling_time_zone: "Pacific",
        time_zone_confidence: "High",
      }),
    );
  });

  it("updates only empty enrichment fields on an existing contact", async () => {
    await expect(
      exportHubSpotContact(lead, candidate, {
        id: "contact-2",
        properties: {
          phone: "existing",
          email: "",
          website: "https://existing.example",
        },
      }),
    ).resolves.toEqual({
      success: true,
      hubspotId: "contact-2",
      action: "updated",
    });
    expect(updateContact).toHaveBeenCalledWith("contact-2", {
      email: candidate.email,
    });
  });
});
