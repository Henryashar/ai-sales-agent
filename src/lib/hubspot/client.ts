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
] as const;

export type HubSpotContact = {
  id: string;
  properties: {
    firstname?: string | null;
    lastname?: string | null;
    company?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    credential_type?: string | null;
    timezone?: string | null;
    hs_lead_source?: string | null;
  };
};

type HubSpotSearchResponse = {
  results?: HubSpotContact[];
};

type HubSpotSearchFilter = {
  propertyName: string;
  operator: "EQ";
  value: string;
};

export async function searchContacts(query: {
  company?: string;
  city?: string;
  state?: string;
  email?: string;
  phone?: string;
}): Promise<HubSpotContact[]> {
  const filterGroups: { filters: HubSpotSearchFilter[] }[] = [];

  const locationFilters = (["company", "city", "state"] as const)
    .map((propertyName) => {
      const value = query[propertyName]?.trim();
      return value
        ? {
            propertyName,
            operator: "EQ" as const,
            value,
          }
        : undefined;
    })
    .filter((filter): filter is HubSpotSearchFilter => Boolean(filter));

  if (locationFilters.length > 0) {
    filterGroups.push({ filters: locationFilters });
  }

  const email = query.email?.trim();
  if (email) {
    filterGroups.push({
      filters: [{ propertyName: "email", operator: "EQ", value: email }],
    });
  }

  const phone = query.phone?.trim();
  if (phone) {
    filterGroups.push({
      filters: [{ propertyName: "phone", operator: "EQ", value: phone }],
    });
  }

  if (filterGroups.length === 0) {
    return [];
  }

  const response = await hubSpotRequest<HubSpotSearchResponse>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups,
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
