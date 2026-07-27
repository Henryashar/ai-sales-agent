# AI Sales Agent Technical Specification

## Purpose

AI Sales Agent is a local Next.js application that turns raw lead data into clean CRM records. The current production workflow is built around pasted NAEA directory text, then dedupes those leads against a Notion CRM, enriches the best insert/update candidates with public business contact data, and exports approved changes back to Notion.

The app currently supports this workflow:

1. Normalize pasted source data into a common `NormalizedLead` object.
2. Read existing CRM records from a configured Notion data source.
3. Score incoming leads against existing Notion records.
4. Classify each lead as insert, update existing, skip, or review.
5. Enrich exportable leads using Google Places, web search snippets, and official-site crawling.
6. Insert new Notion pages or update missing contact fields on existing Notion pages.
7. Write audit notes showing which signed-in user exported or updated records.

## Runtime And Configuration

The app is a Next.js App Router project using React, TypeScript, Zod, the Notion SDK, Google Places, Tavily search, and simple cookie-based local authentication.

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `NOTION_API_KEY` | Authenticates writes and reads against Notion. |
| `NOTION_DATA_SOURCE_ID` | Target Notion CRM data source. May be a raw ID or `collection://...`. |
| `GOOGLE_PLACES_API_KEY` | Enables Google Places enrichment. |
| `SEARCH_API_KEY` | Enables Tavily web search enrichment. |
| `AUTH_SESSION_SECRET` | Signs local auth cookies. |
| `APP_ACCESS_TOKEN` | Shared local login access code. |
| `APP_USERS_JSON` | Optional per-user login codes. |

The app can still normalize and dedupe without Google/Tavily enrichment, but enrichment candidates will be limited or empty if those keys are missing.

## Main API Flow

### 1. Normalize

Endpoint: `POST /api/normalize`

Input:

```json
{
  "rawText": "pasted source text",
  "owner": "Claudia",
  "status": "Cold List",
  "source": "NAEA",
  "batchLabel": "optional label"
}
```

Current parser:

- Function: `normalizeNaeaText(rawText)`
- File: `src/lib/leads/normalize.ts`
- Format expected today: NAEA directory-style pasted text.
- Splits records by address boundaries or blank lines.
- Looks for a city/state/ZIP line in this form:

```text
City, ST ZIP
```

ZIP is optional in the current parser, but city and two-letter state are required.

The current parser assumes this approximate record shape:

```text
Profile Picture
Contact Name
Credential or role lines
Firm Name
City, ST ZIP
United States
```

Ignored lines include:

- `Profile Picture`
- `View Profile`
- `Profile`

Credential-like lines are separated from firm lines using rule patterns such as:

- EA
- CPA
- CFP
- ATA
- ATP
- NTPI Fellow
- Enrolled Agent
- Tax professional
- Accountant
- Owner

Output object:

```ts
type NormalizedLead = {
  id: string;
  contactName: string;
  firmName: string;
  credential?: string;
  city: string;
  state: string;
  zip?: string;
  country?: string;
  rawSourceText: string;
  source: "NAEA";
  parseConfidence: number;
  issues: string[];
};
```

Important current limitation:

The normalize step is hardcoded around NAEA text. It does not currently accept arbitrary CSV, Excel, JSON, or unrelated directory layouts through the UI unless those inputs are first mapped into the `NormalizedLead` shape.

### 2. Dedupe Against Notion

Endpoint: `POST /api/dedupe`

The app reads existing records from Notion using `NOTION_DATA_SOURCE_ID`, then maps each Notion page into this common shape:

```ts
type NotionLead = {
  pageId: string;
  firmName: string;
  contactName?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  callNotes?: string;
};
```

Notion field aliases currently supported for reading:

| Internal field | Notion property names recognized |
| --- | --- |
| `firmName` | `Firm Name`, `Company`, `Organization`, `Name` |
| `contactName` | `Contact Name`, `Contact`, `Person`, `Name` |
| `city` | `City` |
| `state` | `State` |
| `zip` | `ZIP`, `Zip`, `Postal Code` |
| `phone` | `Phone`, `Phone Number` |
| `email` | `Email` |
| `website` | `Website`, `URL`, `Web` |
| `callNotes` | `Call Notes`, `Notes` |

Dedupe scoring:

| Match signal | Points |
| --- | ---: |
| Exact contact name | 35 |
| Similar contact name, Levenshtein similarity >= 0.90 | 25 |
| Exact firm name | 35 |
| Similar firm name, Levenshtein similarity >= 0.90 | 25 |
| Same ZIP | 20 |
| Same city | 12 |
| Same state | 8 |
| Existing lead has phone and firm matches | 2 |

Decision thresholds:

| Score | Action |
| ---: | --- |
| No match | `insert` |
| `>= 92` and existing record is missing phone, email, or website | `update_existing` |
| `>= 92` and existing record already has enrichment fields | `skip` |
| `70-91` | `review` |
| `< 70` | `insert` |

Safety rule:

If the firm is the same but the contact name is different, the score is capped at 68. This prevents different people at the same firm from being treated as automatic duplicates.

Current dedupe limitation:

The dedupe algorithm currently does not use email, phone, website, or external IDs as primary duplicate keys for incoming leads because the current `NormalizedLead` object does not contain those fields. It dedupes mainly on person, firm, and location.

### 3. Enrich

Endpoint: `POST /api/enrich`

Input:

```json
{
  "lead": {
    "id": "...",
    "contactName": "...",
    "firmName": "...",
    "city": "...",
    "state": "CA",
    "zip": "90001",
    "rawSourceText": "...",
    "source": "NAEA",
    "parseConfidence": 100,
    "issues": []
  }
}
```

Enrichment sources:

1. Google Places
2. Tavily web search snippets
3. Official website/domain guesses
4. Contact-page crawling on likely official websites

Candidate output:

```ts
type EnrichmentCandidate = {
  placeId: string;
  sourceType:
    | "google_places"
    | "web_search"
    | "official_site"
    | "website_contact_page";
  displayName: string;
  formattedAddress?: string;
  phone?: string;
  email?: string;
  website?: string;
  googleMapsUrl?: string;
  businessStatus?: string;
  confidenceScore: number;
  confidenceReason: string;
  sourceUrls: string[];
};
```

Google Places scoring favors:

- Firm name appearing in Google place name
- City match
- ZIP match
- Relevant business categories such as accounting, finance, or tax preparation
- Available website
- Available phone

Google Places scoring penalizes:

- Irrelevant business categories
- Closed businesses
- Firm name not matching
- Location mismatch

Export only uses enrichment candidates that:

- Meet the configured confidence threshold, default `70`
- Contain at least one exportable field: phone, email, or website

### 4. Export To Notion

Endpoint: `POST /api/notion/export`

Export handles two actions:

1. `insert`: create a new Notion page.
2. `update_existing`: update missing enrichment fields on an existing Notion page.

Inserted Notion properties:

| Notion property | Source |
| --- | --- |
| `Firm Name` | `lead.firmName` |
| `Contact Name` | `lead.contactName` |
| `City` | `lead.city` |
| `State` | `lead.state` |
| `ZIP` | `lead.zip` |
| `Owner` | selected default |
| `Status` | selected default |
| `Source` | selected default |
| `Call Notes` | credential, batch label, audit note |

Enrichment update properties:

| Notion property | Source |
| --- | --- |
| `Phone` | best enrichment candidate phone |
| `Email` | best enrichment candidate email |
| `Website` | best enrichment candidate website |
| `Call Notes` | append signed-in user audit note when fields are changed |

Update behavior:

The app only writes phone, email, and website if the existing Notion record does not already have that field. It avoids overwriting existing contact values.

## Data Format Required Today

For the app UI as currently built, the input must be pasted NAEA-style text. The minimum viable record needs:

```text
Contact Name
Firm Name
City, ST ZIP
United States
```

The true internal format needed by the dedupe/enrich/export pipeline is:

```json
{
  "id": "stable-lead-id",
  "contactName": "Jane Smith",
  "firmName": "Smith Tax Services",
  "credential": "EA",
  "city": "Los Angeles",
  "state": "CA",
  "zip": "90001",
  "country": "United States",
  "rawSourceText": "original source row or text",
  "source": "NAEA",
  "parseConfidence": 100,
  "issues": []
}
```

Required internal fields:

- `id`
- `contactName`
- `firmName`
- `city`
- `state`
- `rawSourceText`
- `source`
- `parseConfidence`
- `issues`

Optional internal fields:

- `credential`
- `zip`
- `country`

## Can A Different Dataset Be Used?

Yes, but not automatically through the current normalize screen.

The operation is partly flexible and partly hardcoded:

### Flexible parts

Once data is transformed into `NormalizedLead`, these parts can mostly be reused:

- Dedupe against Notion
- Enrichment
- Insert into Notion
- Update missing Notion phone/email/website fields
- Audit trail

### Hardcoded parts

These parts are currently tied to the NAEA workflow:

- The parser expects NAEA text and `City, ST ZIP` address lines.
- `NormalizedLead.source` is currently restricted to literal `"NAEA"`.
- The UI copy and workflow labels refer to NAEA.
- The Notion export fields assume the current NILA Sales Pipeline schema.
- Dedupe does not yet use incoming email/phone because the normalized lead schema does not include them.
- Enrichment queries are tuned for tax/accounting professionals.

## Recommended General Import Contract

To support arbitrary CSV, Excel, JSON, or pasted table data, add a generic import adapter that maps external fields into a broader lead object:

```ts
type GenericLeadInput = {
  externalId?: string;
  contactName: string;
  firmName: string;
  titleOrCredential?: string;
  email?: string;
  phone?: string;
  website?: string;
  address1?: string;
  city: string;
  state: string;
  zip?: string;
  country?: string;
  source: string;
  rawSourceText: string;
};
```

Then update the normalized schema to include:

```ts
type NormalizedLead = {
  id: string;
  externalId?: string;
  contactName: string;
  firmName: string;
  credential?: string;
  email?: string;
  phone?: string;
  website?: string;
  city: string;
  state: string;
  zip?: string;
  country?: string;
  rawSourceText: string;
  source: string;
  parseConfidence: number;
  issues: string[];
};
```

With that change, the system could dedupe with stronger identifiers:

1. Exact external ID match.
2. Exact email match.
3. Exact normalized phone match.
4. Exact website/domain plus firm match.
5. Current fuzzy contact/firm/location score.

## Recommended Input Formats For Future Work

Best format:

CSV or Excel with stable column headers.

Minimum useful columns:

| Column | Required | Notes |
| --- | --- | --- |
| `Contact Name` | Yes | Person name. |
| `Firm Name` | Yes | Business/practice name. |
| `City` | Yes | Used for dedupe and enrichment. |
| `State` | Yes | Two-letter state preferred. |
| `ZIP` | Recommended | Stronger dedupe and enrichment. |
| `Email` | Recommended | Strong duplicate key. |
| `Phone` | Recommended | Strong duplicate key after normalization. |
| `Website` | Optional | Useful for enrichment validation and dedupe. |
| `Source` | Recommended | Example: NAEA, Chamber, Referral, Purchased List. |
| `External ID` | Strongly recommended | Best durable dedupe key if the source system provides one. |

Example CSV:

```csv
External ID,Contact Name,Firm Name,Email,Phone,Website,City,State,ZIP,Source
abc-123,Jane Smith,Smith Tax Services,jane@example.com,213-555-1212,https://smithtax.com,Los Angeles,CA,90001,Chamber
```

## Required Changes To Support Other Datasets Well

1. Add `email`, `phone`, `website`, `externalId`, and generic `source` to `NormalizedLead`.
2. Add CSV/XLSX/JSON import adapters.
3. Add a field-mapping UI so the user can map unknown column names.
4. Update dedupe scoring to prioritize external ID, email, phone, and website.
5. Let `source` accept any configured string, not only `"NAEA"`.
6. Make Notion property mapping configurable instead of assuming the NILA Sales Pipeline fields.
7. Add tests for each new input adapter and duplicate-key strategy.

## Bottom Line

The app is not fundamentally limited to NAEA data, but the current read/normalize step is NAEA-specific. The clean architecture is already halfway there: dedupe, enrichment, and Notion export operate on a normalized internal object. To use different datasets reliably, the app needs a generic import adapter and a slightly broader normalized schema that includes email, phone, website, source, and external ID.
