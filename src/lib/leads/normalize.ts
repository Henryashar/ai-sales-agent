import type { NormalizedLead } from "./schemas";

type ParseResult = {
  leads: NormalizedLead[];
  rejectedBlocks: Array<{ rawSourceText: string; issues: string[] }>;
};

const IGNORABLE_LINES = new Set([
  "profile picture",
  "view profile",
  "profile",
]);

const COUNTRY_LINES = new Set(["united states", "usa", "us"]);

const CREDENTIAL_PATTERNS = [
  /\bea\b/i,
  /\bcpa\b/i,
  /\bcfp\b/i,
  /\bata\b/i,
  /\batp\b/i,
  /ntpi fellow/i,
  /enrolled agent/i,
  /tax professional/i,
  /accountant/i,
  /\bowner\b/i,
];

const ADDRESS_PATTERN = /^(.+?),\s*([A-Za-z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/;

export function normalizeNaeaText(rawText: string): ParseResult {
  const blocks = splitLeadBlocks(rawText);
  const leads: NormalizedLead[] = [];
  const rejectedBlocks: ParseResult["rejectedBlocks"] = [];

  for (const block of blocks) {
    const parsed = parseLeadBlock(block);

    if (parsed.lead) {
      leads.push(parsed.lead);
    } else {
      rejectedBlocks.push({
        rawSourceText: block,
        issues: parsed.issues.length > 0 ? parsed.issues : ["Could not parse lead block."],
      });
    }
  }

  return { leads, rejectedBlocks };
}

export function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function splitLeadBlocks(rawText: string) {
  const normalized = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const addressBoundedBlocks = splitBlocksByAddressBoundaries(normalized);

  if (addressBoundedBlocks.some(blockHasAddressLine)) {
    return addressBoundedBlocks;
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function blockHasAddressLine(block: string) {
  return block.split("\n").some((line) => ADDRESS_PATTERN.test(line.trim()));
}

function splitBlocksByAddressBoundaries(normalized: string) {
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    currentBlock.push(line);

    if (ADDRESS_PATTERN.test(line)) {
      const nextLine = lines[index + 1];

      if (nextLine && COUNTRY_LINES.has(nextLine.toLowerCase())) {
        currentBlock.push(nextLine);
        index += 1;
      }

      blocks.push(currentBlock.join("\n"));
      currentBlock = [];
    }
  }

  if (currentBlock.length) {
    blocks.push(currentBlock.join("\n"));
  }

  return blocks;
}

function parseLeadBlock(rawSourceText: string): { lead?: NormalizedLead; issues: string[] } {
  const issues: string[] = [];
  const lines = rawSourceText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !IGNORABLE_LINES.has(line.toLowerCase()));

  const addressIndex = lines.findIndex((line) => ADDRESS_PATTERN.test(line));

  if (addressIndex === -1) {
    return { issues: ["Missing City, ST ZIP address line."] };
  }

  if (addressIndex === 0) {
    return { issues: ["Missing contact name before address line."] };
  }

  const address = ADDRESS_PATTERN.exec(lines[addressIndex]);
  const city = toTitleCase(address?.[1] ?? "");
  const state = (address?.[2] ?? "").toUpperCase();
  const zip = address?.[3];
  const countryLine = lines[addressIndex + 1];
  const country = countryLine && COUNTRY_LINES.has(countryLine.toLowerCase()) ? "United States" : undefined;
  const contactName = lines[0];

  if (!contactName) {
    return { issues: ["Missing contact name."] };
  }

  const betweenNameAndAddress = lines.slice(1, addressIndex);
  const credentialLines = betweenNameAndAddress.filter(isCredentialLine);
  const firmLines = betweenNameAndAddress.filter((line) => !isCredentialLine(line));
  const firmName = firmLines.join(" ").trim() || contactName;
  const credential = credentialLines.join(", ") || undefined;

  if (firmName === contactName) {
    issues.push("No firm line found; using contact name as firm.");
  }

  if (!country) {
    issues.push("Country line missing or not recognized.");
  }

  const parseConfidence = scoreParse({
    contactName,
    firmName,
    city,
    state,
    zip,
    country,
    issues,
  });

  return {
    lead: {
      id: makeLeadId(contactName, firmName, city, state, zip),
      contactName,
      firmName,
      credential,
      city,
      state,
      zip,
      country,
      rawSourceText,
      source: "NAEA",
      parseConfidence,
      issues,
    },
    issues,
  };
}

function isCredentialLine(line: string) {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(line));
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) => {
      if (/^\s+$|^-$/.test(part)) {
        return part;
      }

      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

function scoreParse(input: {
  contactName: string;
  firmName: string;
  city: string;
  state: string;
  zip?: string;
  country?: string;
  issues: string[];
}) {
  let score = 40;

  if (input.contactName) score += 15;
  if (input.firmName) score += 15;
  if (input.city && input.state) score += 20;
  if (input.zip) score += 10;
  if (input.country) score += 5;
  score -= input.issues.length * 8;

  return Math.max(0, Math.min(100, score));
}

function makeLeadId(contactName: string, firmName: string, city: string, state: string, zip?: string) {
  return normalizeKey([contactName, firmName, city, state, zip ?? ""].join("|"));
}
