# NAEA Lead Enrichment Agent

Frontend-plus-API app for turning pasted NAEA directory text into Notion CRM leads, then enriching high-confidence records with public business contact data.

## Stack

- Next.js App Router
- React, TypeScript, Tailwind CSS
- Zod for request/response validation
- Notion SDK for CRM reads/writes
- OpenAI SDK for structured normalization
- Google Places REST calls for business lookup
- Vitest for parser and dedupe tests

## Local Setup

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Use `npm.cmd` instead of `npm` in PowerShell if script execution policy blocks `npm.ps1`.

## Environment

Create `.env.local` from `.env.example` and fill in:

```bash
OPENAI_API_KEY=
NOTION_API_KEY=
NOTION_DATA_SOURCE_ID=
GOOGLE_PLACES_API_KEY=
SEARCH_API_KEY=
AUTH_SESSION_SECRET=
APP_ACCESS_TOKEN=
APP_USERS_JSON=
```

Keep real secrets out of Git. Only `.env.example` is intended to be committed.

`APP_ACCESS_TOKEN` enables the lightweight sign-in screen with a shared access code. For per-user access codes, set
`APP_USERS_JSON` to a JSON array such as:

```json
[{"name":"Henry","email":"henry@example.com","code":"personal-code"}]
```

Use a long random value for `AUTH_SESSION_SECRET` in Vercel so signed-in sessions survive between requests.

## Workflow

1. Paste one or more NAEA directory records.
2. Normalize the paste into structured leads.
3. Dedupe against the Notion contact list.
4. Enrich the insert/update candidates.
5. Use **Export to Notion** to insert new leads and update matched Notion pages with the best available phone, email, and website fields.

For Vercel, set the same environment variables in the project settings before deploying.

## Verification

```bash
npm run lint
npm run build
npm test -- --run
npm audit --audit-level=moderate
```
