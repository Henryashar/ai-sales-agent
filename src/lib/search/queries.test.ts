import { describe, expect, it } from "vitest";

import { buildFirmDomainGuesses, buildLeadSearchQueries, isPersonNameOnlyLead } from "./queries";
import type { NormalizedLead } from "../leads/schemas";

const lead: NormalizedLead = {
  id: "lead-1",
  contactName: "Juan Diego Hidalgo Cossio",
  firmName: "Hidalgo Bookkeeping & Taxes LLC",
  city: "Bellflower",
  state: "CA",
  zip: "90706",
  rawSourceText: "raw",
  source: "NAEA",
  parseConfidence: 100,
  issues: [],
};

describe("buildLeadSearchQueries", () => {
  it("creates firm and person variants", () => {
    const queries = buildLeadSearchQueries(lead);

    expect(queries).toContain('"Hidalgo Bookkeeping & Taxes LLC" Bellflower CA tax');
    expect(queries).toContain('"Juan Diego Hidalgo Cossio" Bellflower CA tax');
  });

  it("detects person-name-only leads", () => {
    expect(isPersonNameOnlyLead({ ...lead, firmName: "Juan Diego Hidalgo Cossio" })).toBe(true);
  });

  it("builds conservative firm domain guesses", () => {
    expect(buildFirmDomainGuesses({ ...lead, firmName: "MAQUE ENTERPRISE CORPORATION" })).toContain(
      "https://maqueenterprise.com",
    );
  });
});
