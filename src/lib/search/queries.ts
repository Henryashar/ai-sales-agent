import type { NormalizedLead } from "../leads/schemas";

export function buildLeadSearchQueries(lead: NormalizedLead) {
  const queries = new Set<string>();
  const firm = quoteIfUseful(lead.firmName);
  const contact = quoteIfUseful(lead.contactName);
  const location = [lead.city, lead.state].filter(Boolean).join(" ");

  if (!isPersonNameOnlyLead(lead)) {
    queries.add([firm, location, "tax"].filter(Boolean).join(" "));
    queries.add([firm, location, "contact"].filter(Boolean).join(" "));
    queries.add([firm, "phone email"].filter(Boolean).join(" "));
    queries.add([firm, "website"].filter(Boolean).join(" "));
    queries.add([firm, "phone"].filter(Boolean).join(" "));
    queries.add([firm, lead.contactName, "tax"].filter(Boolean).join(" "));
  }

  queries.add([contact, location, "tax"].filter(Boolean).join(" "));
  queries.add([contact, "enrolled agent"].filter(Boolean).join(" "));
  queries.add([contact, lead.firmName, "contact"].filter(Boolean).join(" "));

  return Array.from(queries).filter(Boolean).slice(0, 8);
}

export function buildFirmDomainGuesses(lead: NormalizedLead) {
  if (isPersonNameOnlyLead(lead)) {
    return [];
  }

  const tokens = lead.firmName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !["the", "and", "inc", "llc", "corp", "corporation", "company", "services", "service"].includes(token));
  const compact = tokens.join("");
  const hyphenated = tokens.join("-");

  return Array.from(
    new Set([compact, hyphenated].filter((value) => value.length >= 8).flatMap((value) => [`https://${value}.com`, `https://www.${value}.com`])),
  );
}

export function isPersonNameOnlyLead(lead: NormalizedLead) {
  return normalizeName(lead.contactName) === normalizeName(lead.firmName);
}

export function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function quoteIfUseful(value: string) {
  return value.includes(" ") ? `"${value}"` : value;
}
