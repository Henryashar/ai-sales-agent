import type { NormalizedLead } from "../leads/schemas";
import { buildLeadSearchQueries } from "./queries";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_QUERY_TIMEOUT_MS = 6_000;
const MAX_SEARCH_QUERIES = 5;

export type WebSearchResult = {
  title: string;
  url: string;
  content?: string;
  query: string;
};

export async function searchLeadWeb(lead: NormalizedLead): Promise<WebSearchResult[]> {
  const apiKey = process.env.SEARCH_API_KEY;

  if (!apiKey) {
    return [];
  }

  const results = await Promise.all(
    buildLeadSearchQueries(lead)
      .slice(0, MAX_SEARCH_QUERIES)
      .map((query) => runSearchQuery(apiKey, query)),
  );

  return dedupeByUrl(results.flat()).slice(0, 10);
}

async function runSearchQuery(apiKey: string, query: string): Promise<WebSearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TAVILY_QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results: WebSearchResult[] = [];

    for (const result of payload.results ?? []) {
      if (!result.url || !result.title) {
        continue;
      }

      results.push({
        title: result.title,
        url: result.url,
        content: result.content,
        query,
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function dedupeByUrl(results: WebSearchResult[]) {
  const seen = new Set<string>();
  const deduped: WebSearchResult[] = [];

  for (const result of results) {
    const key = result.url.replace(/\/$/, "");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}
