import { describe, expect, it } from "vitest";

import { normalizeKey, normalizeNaeaText } from "./normalize";

describe("normalizeNaeaText", () => {
  it("parses a standard NAEA paste block", () => {
    const result = normalizeNaeaText(`Profile Picture
MaryJane Link
The Tax Link

Seal Beach, CA 90740-4522
United States`);

    expect(result.rejectedBlocks).toEqual([]);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({
      contactName: "MaryJane Link",
      firmName: "The Tax Link",
      city: "Seal Beach",
      state: "CA",
      zip: "90740-4522",
      country: "United States",
      source: "NAEA",
      issues: [],
    });
    expect(result.leads[0].parseConfidence).toBeGreaterThanOrEqual(85);
  });

  it("separates credential lines from firm lines", () => {
    const result = normalizeNaeaText(`Profile Picture
Jordan Smith
EA, NTPI Fellow
Smith Tax Advisory

Austin, TX 78701
United States`);

    expect(result.leads[0]).toMatchObject({
      contactName: "Jordan Smith",
      firmName: "Smith Tax Advisory",
      credential: "EA, NTPI Fellow",
    });
  });

  it("uses contact name as firm when no firm line exists", () => {
    const result = normalizeNaeaText(`Profile Picture
Alex Rivera

Phoenix, AZ 85004
United States`);

    expect(result.leads[0]).toMatchObject({
      contactName: "Alex Rivera",
      firmName: "Alex Rivera",
      issues: ["No firm line found; using contact name as firm."],
    });
  });

  it("splits multiple profile blocks", () => {
    const result = normalizeNaeaText(`Profile Picture
MaryJane Link
The Tax Link

Seal Beach, CA 90740-4522
United States
Profile Picture
Jordan Smith
Smith Tax Advisory

Austin, TX 78701
United States`);

    expect(result.leads).toHaveLength(2);
    expect(result.leads.map((lead) => lead.contactName)).toEqual(["MaryJane Link", "Jordan Smith"]);
  });

  it("splits multiple blocks when profile picture labels are missing", () => {
    const result = normalizeNaeaText(`MaryJane Link
The Tax Link

Seal Beach, CA 90740-4522
United States

Jordan Smith
Smith Tax Advisory

Austin, TX 78701
United States

Alex Rivera
Rivera Tax Group

Phoenix, AZ 85004
United States`);

    expect(result.rejectedBlocks).toEqual([]);
    expect(result.leads).toHaveLength(3);
    expect(result.leads.map((lead) => lead.contactName)).toEqual(["MaryJane Link", "Jordan Smith", "Alex Rivera"]);
  });

  it("handles view profile separators between copied records", () => {
    const result = normalizeNaeaText(`Profile Picture
MaryJane Link
The Tax Link

Seal Beach, CA 90740-4522
United States
View Profile
Jordan Smith
Smith Tax Advisory

Austin, TX 78701
United States`);

    expect(result.rejectedBlocks).toEqual([]);
    expect(result.leads).toHaveLength(2);
    expect(result.leads[1]).toMatchObject({
      contactName: "Jordan Smith",
      firmName: "Smith Tax Advisory",
    });
  });

  it("accepts an address line without a ZIP code", () => {
    const result = normalizeNaeaText(`Profile Picture
Taylor Chen
Chen Tax

Portland, OR
United States`);

    expect(result.rejectedBlocks).toEqual([]);
    expect(result.leads[0]).toMatchObject({
      contactName: "Taylor Chen",
      city: "Portland",
      state: "OR",
    });
    expect(result.leads[0].zip).toBeUndefined();
  });

  it("rejects blocks without a city state zip line", () => {
    const result = normalizeNaeaText(`Profile Picture
No Address
No Firm`);

    expect(result.leads).toEqual([]);
    expect(result.rejectedBlocks).toHaveLength(1);
    expect(result.rejectedBlocks[0].issues).toEqual(["Missing City, ST ZIP address line."]);
  });

  it("rejects address-only blocks instead of treating address as contact", () => {
    const result = normalizeNaeaText(`Seal Beach, CA 90740-4522
United States`);

    expect(result.leads).toEqual([]);
    expect(result.rejectedBlocks).toHaveLength(1);
    expect(result.rejectedBlocks[0].issues).toEqual(["Missing contact name before address line."]);
  });
});

describe("normalizeKey", () => {
  it("normalizes punctuation and casing", () => {
    expect(normalizeKey("The Tax Link, LLC 90740-4522")).toBe("thetaxlinkllc907404522");
  });
});
