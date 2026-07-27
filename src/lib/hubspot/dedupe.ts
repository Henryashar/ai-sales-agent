import type { NormalizedLead, NotionLead } from "../leads/schemas";
import { searchContacts } from "./client";

export async function findHubSpotLeadsForDedupe(lead: NormalizedLead): Promise<NotionLead[]> {
  const contacts = await searchContacts({
    company: lead.firmName,
    city: lead.city,
    state: lead.state,
  });

  return contacts.map((contact) => {
    const contactName = [contact.properties.firstname, contact.properties.lastname]
      .filter(Boolean)
      .join(" ")
      .trim();

    return {
      pageId: contact.id,
      contactName: contactName || undefined,
      firmName: contact.properties.company ?? "",
      city: contact.properties.city,
      state: contact.properties.state,
      zip: contact.properties.zip,
      phone: contact.properties.phone,
      email: contact.properties.email,
      website: contact.properties.website,
    };
  });
}
