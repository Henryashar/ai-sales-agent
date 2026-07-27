# Running Locally

Double-click `run-ai-sales-agent.cmd`.

The launcher starts a local Next.js server at `http://127.0.0.1:3000` and opens it in your browser. Keep the console window open while using the app. Closing the window stops the local backend.

This app is not static-only. The local Next.js server handles API routes for normalization, dedupe, enrichment, sign-in, and Notion updates. Your browser talks to that local server, and the server talks to Notion, OpenAI, Google Places, and search APIs using `.env.local`.

For quick local-only sign-in, if no `APP_ACCESS_TOKEN` or `APP_USERS_JSON` is configured, the launcher temporarily uses:

```text
Access code: local-only
```

For real per-user tracking, set `AUTH_SESSION_SECRET` and `APP_USERS_JSON` in `.env.local`:

```json
[{"name":"Henry","email":"henry@example.com","code":"personal-code"}]
```

Each Notion export or enrichment update writes the signed-in name and email into `Call Notes`.
