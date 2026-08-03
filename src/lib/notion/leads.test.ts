import { describe, expect, it } from "vitest";

import { normalizeNotionId } from "./ids";
import { buildCreateLeadProperties, buildEnrichmentUpdateProperties, mapPageToNotionLead, pickExportCandidate } from "./leads";

describe("normalizeNotionId", () => {
  it("strips collection prefixes", () => {
    expect(normalizeNotionId("collection://9ef9d607-7468-416b-8253-947c316565ff")).toBe(
      "9ef9d607-7468-416b-8253-947c316565ff",
    );
  });
});

describe("mapPageToNotionLead", () => {
  it("maps common CRM properties from a Notion page", () => {
    const lead = mapPageToNotionLead({
      object: "page",
      id: "page-1",
      properties: {
        "Firm Name": { type: "title", title: [{ plain_text: "The Tax Link" }] },
        "Contact Name": { type: "rich_text", rich_text: [{ plain_text: "MaryJane Link" }] },
        City: { type: "rich_text", rich_text: [{ plain_text: "Seal Beach" }] },
        State: { type: "select", select: { name: "CA" } },
        ZIP: { type: "rich_text", rich_text: [{ plain_text: "90740-4522" }] },
        Phone: { type: "phone_number", phone_number: "562-555-0100" },
        Email: { type: "email", email: "hello@example.com" },
        Website: { type: "url", url: "https://example.com" },
        "Call Notes": { type: "rich_text", rich_text: [{ plain_text: "Existing note" }] },
      },
    });

    expect(lead).toEqual({
      pageId: "page-1",
      firmName: "The Tax Link",
      contactName: "MaryJane Link",
      city: "Seal Beach",
      state: "CA",
      zip: "90740-4522",
      phone: "562-555-0100",
      email: "hello@example.com",
      website: "https://example.com",
      callNotes: "Existing note",
    });
  });
});

describe("buildCreateLeadProperties", () => {
  it("maps normalized leads to existing user-facing Notion fields", () => {
    const properties = buildCreateLeadProperties(
      {
        id: "lead-1",
        contactName: "MaryJane Link",
        firmName: "The Tax Link",
        credential: "EA",
        city: "Seal Beach",
        state: "CA",
        zip: "90740-4522",
        country: "United States",
        rawSourceText: "raw",
        source: "NAEA",
        parseConfidence: 100,
        issues: [],
      },
      {
        owner: "Henry",
        status: "Cold List",
        source: "NAEA",
        batchLabel: "Seal Beach May 2026",
      },
    );

    expect(properties["Firm Name"]).toMatchObject({
      type: "title",
      title: [{ text: { content: "The Tax Link" } }],
    });
    expect(properties["Contact Name"]).toMatchObject({
      type: "rich_text",
      rich_text: [{ text: { content: "MaryJane Link" } }],
    });
    expect(properties.ZIP).toMatchObject({
      type: "rich_text",
      rich_text: [{ text: { content: "90740-4522" } }],
    });
    expect(properties.Owner).toMatchObject({ type: "select", select: { name: "Henry" } });
    expect(properties.Status).toMatchObject({ type: "select", select: { name: "Cold List" } });
    expect(properties.Source).toMatchObject({ type: "select", select: { name: "NAEA" } });
    expect(properties["Call Notes"]).toMatchObject({
      type: "rich_text",
      rich_text: [
        {
          text: {
            content: "Credential: EA. Batch: Seal Beach May 2026.",
          },
        },
      ],
    });
  });

  it("adds the signed-in user to create notes", () => {
    const properties = buildCreateLeadProperties(
      {
        id: "lead-1",
        contactName: "MaryJane Link",
        firmName: "The Tax Link",
        city: "Seal Beach",
        state: "CA",
        rawSourceText: "raw",
        source: "NAEA",
        parseConfidence: 100,
        issues: [],
      },
      {
        owner: "Henry",
        status: "Lead",
        source: "Referral",
      },
      {
        name: "Henry",
        email: "henry@example.com",
      },
    );

    expect(properties["Call Notes"]).toMatchObject({
      type: "rich_text",
      rich_text: [
        {
          text: {
            content: expect.stringContaining("Exported by Henry (henry@example.com)"),
          },
        },
      ],
    });
  });
});

describe("buildEnrichmentUpdateProperties", () => {
  it("only writes populated enrichment fields", () => {
    expect(
      buildEnrichmentUpdateProperties({
        placeId: "place-1",
        sourceType: "google_places",
        displayName: "Example Firm",
        phone: "(562) 555-0100",
        email: "hello@example.com",
        website: "https://example.com",
        confidenceScore: 100,
        confidenceReason: "matched",
        sourceUrls: ["https://example.com"],
      }),
    ).toEqual({
      Phone: { type: "phone_number", phone_number: "(562) 555-0100" },
      Email: { type: "email", email: "hello@example.com" },
      Website: { type: "url", url: "https://example.com" },
    });
  });

  it("does not overwrite fields already present in Notion", () => {
    expect(
      buildEnrichmentUpdateProperties(
        {
          placeId: "place-1",
          sourceType: "official_site",
          displayName: "Example Firm",
          phone: "(562) 555-0100",
          email: "hello@example.com",
          website: "https://example.com",
          confidenceScore: 100,
          confidenceReason: "matched",
          sourceUrls: ["https://example.com"],
        },
        {
          pageId: "page-1",
          firmName: "Example Firm",
          phone: "(562) 555-0100",
          website: "https://example.com",
        },
      ),
    ).toEqual({
      Email: { type: "email", email: "hello@example.com" },
    });
  });

  it("appends signed-in user details when enrichment fields change", () => {
    const properties = buildEnrichmentUpdateProperties(
      {
        placeId: "place-1",
        sourceType: "official_site",
        displayName: "Example Firm",
        email: "hello@example.com",
        confidenceScore: 100,
        confidenceReason: "matched",
        sourceUrls: ["https://example.com"],
      },
      {
        pageId: "page-1",
        firmName: "Example Firm",
        callNotes: "Imported from NAEA.",
      },
      {
        name: "Claudia",
        email: "claudia@example.com",
      },
    );

    expect(properties.Email).toEqual({ type: "email", email: "hello@example.com" });
    expect(properties["Call Notes"]).toMatchObject({
      type: "rich_text",
      rich_text: [
        {
          text: {
            content: expect.stringContaining("Imported from NAEA.\nUpdated by Claudia (claudia@example.com)"),
          },
        },
      ],
    });
  });
});

describe("pickExportCandidate", () => {
  it("chooses the highest-confidence candidate with exportable contact fields", () => {
    expect(
      pickExportCandidate([
        {
          placeId: "low",
          sourceType: "web_search",
          displayName: "Low Confidence",
          phone: "562-555-0100",
          confidenceScore: 65,
          confidenceReason: "weak match",
          sourceUrls: ["https://low.example.com"],
        },
        {
          placeId: "empty",
          sourceType: "google_places",
          displayName: "No Contact Fields",
          confidenceScore: 99,
          confidenceReason: "strong match",
          sourceUrls: ["https://empty.example.com"],
        },
        {
          placeId: "best",
          sourceType: "official_site",
          displayName: "Best Contact",
          website: "https://best.example.com",
          confidenceScore: 88,
          confidenceReason: "matched firm and city",
          sourceUrls: ["https://best.example.com"],
        },
      ]),
    ).toMatchObject({ placeId: "best" });
  });
});
