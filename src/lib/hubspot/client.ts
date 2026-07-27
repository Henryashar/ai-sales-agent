const HUBSPOT_BASE_URL = "https://api.hubapi.com";

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "company",
  "city",
  "state",
  "zip",
  "phone",
  "email",
  "website",
  "credential_type",
  "timezone",
  "hs_lead_source",
] as const;

export type HubSpotContact = {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    company?: string;
    city?: string;
    state?: string;
    zip?: string;
    phone?: string;
    email?: string;
    website?: string;
    credential_type?: string;
    timezone?: string;
    hs_lead_source?: string;
  };
};

type HubSpotSearchResponse = {
  results?: HubSpotContact[];
};

export async function searchContacts(query: {
  company?: string;
  city?: string;
  state?: string;
}): Promise<HubSpotContact[]> {
  const filters = Object.entries(query)
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([propertyName, value]) => ({
      propertyName,
      operator: "EQ",
      value: value.trim(),
    }));

  if (filters.length === 0) {
    return [];
  }

  const response = await hubSpotRequest<HubSpotSearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters }],
      properties: CONTACT_PROPERTIES,
      limit: 100,
    }),
  });

  return response.results ?? [];
}

export async function createContact(properties: Record<string, string>): Promise<{ id: string }> {
  return hubSpotRequest<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

export async function updateContact(id: string, properties: Record<string, string>): Promise<void> {
  await hubSpotRequest(`/crm/v3/objects/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

async function hubSpotRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("Missing HUBSPOT_ACCESS_TOKEN.");
  }

  const response = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new HubSpotApiError(response.status, detail || response.statusText);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export class HubSpotApiError extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(`HubSpot API request failed (${status}): ${detail}`);
    this.name = "HubSpotApiError";
  }
}
