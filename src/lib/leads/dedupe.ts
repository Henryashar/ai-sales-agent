import { normalizeKey } from "./normalize";
import type { DedupeDecision, NormalizedLead, NotionLead } from "./schemas";

export function dedupeLeads(incomingLeads: NormalizedLead[], existingLeads: NotionLead[]): DedupeDecision[] {
  return incomingLeads.map((incomingLead) => {
    const bestMatch = findBestMatch(incomingLead, existingLeads);

    if (!bestMatch) {
      return {
        incomingLead,
        action: "insert",
        matchScore: 0,
        matchReason: "No matching CRM record found.",
      };
    }

    const hasMissingContactFields = !bestMatch.lead.phone || !bestMatch.lead.email || !bestMatch.lead.website;

    if (bestMatch.score >= 92 && hasMissingContactFields) {
      return {
        incomingLead,
        action: "update_existing",
        matchedLead: bestMatch.lead,
        matchedPageId: bestMatch.lead.pageId,
        matchScore: bestMatch.score,
        matchReason: `${bestMatch.reason}; existing record has missing enrichment fields.`,
      };
    }

    if (bestMatch.score >= 92) {
      return {
        incomingLead,
        action: "skip",
        matchedLead: bestMatch.lead,
        matchedPageId: bestMatch.lead.pageId,
        matchScore: bestMatch.score,
        matchReason: bestMatch.reason,
      };
    }

    if (bestMatch.score >= 70) {
      return {
        incomingLead,
        action: "review",
        matchedLead: bestMatch.lead,
        matchedPageId: bestMatch.lead.pageId,
        matchScore: bestMatch.score,
        matchReason: bestMatch.reason,
      };
    }

    return {
      incomingLead,
      action: "insert",
      matchScore: bestMatch.score,
      matchReason: `No duplicate found. Closest weak overlap: ${bestMatch.reason}.`,
    };
  });
}

function findBestMatch(incomingLead: NormalizedLead, existingLeads: NotionLead[]) {
  let bestMatch: { lead: NotionLead; score: number; reason: string } | undefined;

  for (const existingLead of existingLeads) {
    const match = scoreLeadMatch(incomingLead, existingLead);

    if (!bestMatch || match.score > bestMatch.score) {
      bestMatch = { lead: existingLead, ...match };
    }
  }

  return bestMatch && bestMatch.score > 0 ? bestMatch : undefined;
}

export function scoreLeadMatch(incomingLead: NormalizedLead, existingLead: NotionLead) {
  const reasons: string[] = [];
  let score = 0;

  const incomingContact = normalizeKey(incomingLead.contactName);
  const existingContact = normalizeKey(existingLead.contactName ?? "");
  const incomingFirm = normalizeKey(incomingLead.firmName);
  const existingFirm = normalizeKey(existingLead.firmName);
  const incomingCity = normalizeKey(incomingLead.city);
  const existingCity = normalizeKey(existingLead.city ?? "");
  const incomingZip = normalizeKey(incomingLead.zip ?? "");
  const existingZip = normalizeKey(existingLead.zip ?? "");
  const incomingState = normalizeKey(incomingLead.state);
  const existingState = normalizeKey(existingLead.state ?? "");

  if (incomingContact && existingContact && incomingContact === existingContact) {
    score += 35;
    reasons.push("same contact name");
  } else if (incomingContact && existingContact && similarity(incomingContact, existingContact) >= 0.9) {
    score += 25;
    reasons.push("similar contact name");
  }

  if (incomingFirm && existingFirm && incomingFirm === existingFirm) {
    score += 35;
    reasons.push("same firm name");
  } else if (incomingFirm && existingFirm && similarity(incomingFirm, existingFirm) >= 0.9) {
    score += 25;
    reasons.push("similar firm name");
  }

  if (incomingZip && existingZip && incomingZip === existingZip) {
    score += 20;
    reasons.push("same ZIP");
  } else if (incomingCity && existingCity && incomingCity === existingCity) {
    score += 12;
    reasons.push("same city");
  }

  if (incomingState && existingState && incomingState === existingState) {
    score += 8;
    reasons.push("same state");
  }

  if (existingLead.phone && existingFirm && incomingFirm === existingFirm) {
    score += 2;
  }

  const sameFirmDifferentContact =
    incomingFirm && existingFirm && incomingFirm === existingFirm && incomingContact !== existingContact;

  if (sameFirmDifferentContact) {
    score = Math.min(score, 68);
    reasons.push("same firm but different contact");
  }

  return {
    score: Math.min(score, 100),
    reason: reasons.length > 0 ? reasons.join(", ") : "no meaningful overlap",
  };
}

function similarity(left: string, right: string) {
  if (left === right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshtein(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, rowIndex) => [rowIndex]);

  for (let columnIndex = 1; columnIndex <= right.length; columnIndex += 1) {
    rows[0][columnIndex] = columnIndex;
  }

  for (let rowIndex = 1; rowIndex <= left.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= right.length; columnIndex += 1) {
      const substitutionCost = left[rowIndex - 1] === right[columnIndex - 1] ? 0 : 1;
      rows[rowIndex][columnIndex] = Math.min(
        rows[rowIndex - 1][columnIndex] + 1,
        rows[rowIndex][columnIndex - 1] + 1,
        rows[rowIndex - 1][columnIndex - 1] + substitutionCost,
      );
    }
  }

  return rows[left.length][right.length];
}
