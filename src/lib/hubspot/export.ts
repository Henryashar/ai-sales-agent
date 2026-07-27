import type { EnrichmentCandidate, NormalizedLead } from "../leads/schemas";
import { getTimezoneFromPhone } from "../timezone";
import { createContact, type HubSpotContact, updateContact } from "./client";

export type HubSpotExportResult = {
  success: boolean;
  hubspotId: string;
  action: "inserted" | "updated" | "skipped";
};

export async function exportHubSpotContact(
  lead: NormalizedLead & { phone?: string },
  candidate?: EnrichmentCandidate,
  existingContact?: HubSpotContact,
): Promise<HubSpotExportResult> {
  if (existingContact) {
    const properties = buildMissingEnrichmentProperties(candidate, existingContact);

    if (Object.keys(properties).length === 0) {
      return {
        success: true,
        hubspotId: existingContact.id,
        action: "skipped",
      };
    }

    await updateContact(existingContact.id, properties);

    return {
      success: true,
      hubspotId: existingContact.id,
      action: "updated",
    };
  }

  const phoneForTimezone = lead.phone ?? candidate?.phone ?? "";
  const timezone = getTimezoneFromPhone(phoneForTimezone);
  const [firstname = "", ...lastNameParts] = lead.contactName.trim().split(/\s+/);
  const created = await createContact({
    firstname,
    lastname: lastNameParts.join(" "),
    company: lead.firmName,
    city: lead.city,
    state: lead.state,
    zip: lead.zip ?? "",
    hs_lead_source: lead.source,
    credential_type: lead.credential ?? "",
    time_zone: timezone,
    likely_calling_time_zone: timezone,
    time_zone_confidence: timezone === "Unknown" ? "Low" : "High",
    time_zone_source: "Phone Area Code",
    phone: candidate?.phone ?? "",
    email: candidate?.email ?? "",
    website: candidate?.website ?? "",
  });

  return {
    success: true,
    hubspotId: created.id,
    action: "inserted",
  };
}

function buildMissingEnrichmentProperties(
  candidate: EnrichmentCandidate | undefined,
  existingContact: HubSpotContact,
) {
  const properties: Record<string, string> = {};

  if (candidate?.phone && !existingContact.properties.phone) {
    properties.phone = candidate.phone;
  }

  if (candidate?.email && !existingContact.properties.email) {
    properties.email = candidate.email;
  }

  if (candidate?.website && !existingContact.properties.website) {
    properties.website = candidate.website;
  }

  return properties;
}
